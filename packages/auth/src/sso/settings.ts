import { isBuiltInRole } from '@manablox/core';
import type { InvitationGrant, SsoProviderRow, SsoProviderWriteData } from '@manablox/db';
import { invalid, type SsoContext } from './context.js';
import { splitDomains } from './domains.js';
import { oidcConfig } from './oidc.js';
import { samlConfig } from './saml.js';
import type { SsoSamlInput, SsoSettingsInput } from './types.js';

/** Provider ids better-auth keeps for itself. */
const RESERVED_IDS = new Set([
  'credential',
  'email-otp',
  'magic-link',
  'phone-number',
  'anonymous',
]);
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** A new provider's slug, lower-cased; well-formed, not better-auth's and not taken. */
export async function providerIdOf(ctx: SsoContext, input: string): Promise<string> {
  const providerId = input.trim().toLowerCase();
  if (!PROVIDER_ID.test(providerId) || RESERVED_IDS.has(providerId)) {
    throw invalid([{ key: 'sso.providerId.invalid', path: ['providerId'] }]);
  }
  if (await ctx.repos.ssoProviders.providerIdTaken(providerId)) {
    throw invalid([{ key: 'sso.providerId.taken', path: ['providerId'] }]);
  }
  return providerId;
}

/** Validates and builds the stored settings; OIDC endpoints come from discovery. */
export async function providerSettings(
  ctx: SsoContext,
  providerId: string,
  input: SsoSettingsInput,
  before: SsoProviderRow | null,
): Promise<Omit<SsoProviderWriteData, 'providerId'>> {
  if (Boolean(input.oidc) === Boolean(input.saml)) {
    throw invalid([{ key: 'sso.protocol.required', path: ['oidc'] }]);
  }
  const domains = await checkDomains(ctx, input.domains, before?.id);
  const defaultGrants = await checkGrants(ctx, input.defaultGrants ?? []);
  const common = {
    name: input.name.trim() || providerId,
    domain: domains.join(','),
    requireSso: input.requireSso ?? false,
    showOnSignIn: input.showOnSignIn ?? false,
    createAccounts: input.createAccounts ?? true,
    defaultGrants,
  };
  if (input.oidc) {
    const oidc = await oidcConfig(ctx, input.oidc, before);
    return { ...common, issuer: oidc.issuer, oidcConfig: JSON.stringify(oidc), samlConfig: null };
  }
  const saml = await samlConfig(ctx, providerId, input.saml as SsoSamlInput, before);
  return { ...common, issuer: saml.issuer, oidcConfig: null, samlConfig: JSON.stringify(saml) };
}

/** Unique, well-formed domains no other provider serves. */
async function checkDomains(
  ctx: SsoContext,
  input: readonly string[],
  exceptId?: string,
): Promise<string[]> {
  const domains = [
    ...new Set(input.map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))),
  ].filter(Boolean);
  if (domains.length === 0) {
    throw invalid([{ key: 'sso.domains.required', path: ['domains'] }]);
  }
  for (const [index, domain] of domains.entries()) {
    if (!DOMAIN.test(domain)) {
      throw invalid([{ key: 'sso.domain.invalid', path: ['domains', index], params: { domain } }]);
    }
  }
  for (const row of await ctx.repos.ssoProviders.list()) {
    if (row.id === exceptId) continue;
    const taken = domains.find((domain) => splitDomains(row.domain).includes(domain));
    if (taken) {
      throw invalid([
        {
          key: 'sso.domain.taken',
          path: ['domains', domains.indexOf(taken)],
          params: { domain: taken, provider: row.name },
        },
      ]);
    }
  }
  return domains;
}

/** Spaces and roles that exist; custom roles need the space's `customRoles` feature. */
async function checkGrants(
  ctx: SsoContext,
  grants: readonly InvitationGrant[],
): Promise<InvitationGrant[]> {
  const seen = new Set<string>();
  for (const [index, grant] of grants.entries()) {
    if (seen.has(grant.spaceId)) {
      throw invalid([{ key: 'invitation.grant.duplicate', path: ['defaultGrants', index] }]);
    }
    seen.add(grant.spaceId);
    if (!(await ctx.repos.spaces.findById(grant.spaceId))) {
      throw invalid([
        { key: 'invitation.space.notFound', path: ['defaultGrants', index, 'spaceId'] },
      ]);
    }
    if (!isBuiltInRole(grant.role)) {
      if (!(await ctx.repos.roles.findByMachineName(grant.spaceId, grant.role))) {
        throw invalid([{ key: 'invitation.role.unknown', path: ['defaultGrants', index, 'role'] }]);
      }
      await ctx.manablox.controls.assertFeature(grant.spaceId, 'customRoles');
    }
  }
  return grants.map((grant) => ({ spaceId: grant.spaceId, role: grant.role }));
}
