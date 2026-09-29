import { decryptSecret, secretHint } from '@manablox/core/node';
import type { SsoProviderRow } from '@manablox/db';
import { providerUrls, type SsoContext } from './context.js';
import { splitDomains } from './domains.js';
import { certificateOf, expiryOf, parseJson, type StoredOidc, type StoredSaml } from './stored.js';
import { DEFAULT_OIDC_SCOPES, type SsoProtocol, type SsoProviderView } from './types.js';

/** Providers as the admin sees them: settings, URLs for the IdP, never a secret. */
export async function providerViews(
  ctx: SsoContext,
  rows: readonly SsoProviderRow[],
): Promise<SsoProviderView[]> {
  const spaceIds = [
    ...new Set(rows.flatMap((row) => row.defaultGrants.map((grant) => grant.spaceId))),
  ];
  const spaces = spaceIds.length ? await ctx.repos.spaces.listByIds(spaceIds) : [];
  const spaceName = new Map(spaces.map((space) => [space.id, space.name]));
  return Promise.all(
    rows.map(async (row) => {
      const oidc = parseJson<StoredOidc>(row.oidcConfig);
      const saml = parseJson<StoredSaml>(row.samlConfig);
      const protocol: SsoProtocol = saml ? 'saml' : 'oidc';
      const urls = await providerUrls(ctx, row.providerId, protocol);
      return {
        id: row.id,
        providerId: row.providerId,
        name: row.name,
        protocol,
        domains: splitDomains(row.domain),
        oidc: oidc
          ? {
              issuer: oidc.issuer,
              clientId: oidc.clientId,
              clientSecretHint: hint(ctx, oidc.clientSecret),
              discoveryEndpoint: oidc.discoveryEndpoint,
              scopes: oidc.scopes ?? DEFAULT_OIDC_SCOPES,
            }
          : null,
        saml: saml
          ? {
              entryPoint: saml.entryPoint,
              certificate: saml.cert,
              certificateExpiresAt: expiryOf(saml.cert),
              idpEntityId: saml.idpMetadata.entityID,
              spEntityId: saml.issuer,
              emailAttribute: saml.mapping?.email ?? null,
              nameAttribute: saml.mapping?.name ?? null,
              signRequests: saml.authnRequestsSigned === true,
              encryptAssertions: saml.idpMetadata.isAssertionEncrypted === true,
              idpInitiated: saml.idpInitiated === true,
              landingPath: saml.landingPath ?? '/',
              spCertificate: saml.spCertificate ?? null,
              spCertificateExpiresAt: saml.spCertificate ? expiryOf(saml.spCertificate) : null,
            }
          : null,
        requireSso: row.requireSso,
        showOnSignIn: row.showOnSignIn,
        createAccounts: row.createAccounts,
        defaultGrants: row.defaultGrants.map((grant) => ({
          ...grant,
          spaceName: spaceName.get(grant.spaceId) ?? null,
        })),
        urls: { ...urls, spEntityId: saml ? saml.issuer : null },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  );
}

function hint(ctx: SsoContext, stored: string | undefined): string | null {
  if (!stored) return null;
  try {
    return secretHint(decryptSecret(stored, ctx.secret));
  } catch {
    return null;
  }
}

/** The audited facts of a provider; never its secret. */
export function summary(row: SsoProviderRow): Record<string, unknown> {
  const oidc = parseJson<StoredOidc>(row.oidcConfig);
  const saml = parseJson<StoredSaml>(row.samlConfig);
  return {
    providerId: row.providerId,
    name: row.name,
    protocol: saml ? 'saml' : 'oidc',
    domains: splitDomains(row.domain),
    issuer: row.issuer,
    ...(oidc ? { clientId: oidc.clientId, scopes: oidc.scopes } : {}),
    ...(saml
      ? {
          entryPoint: saml.entryPoint,
          idpEntityId: saml.idpMetadata.entityID,
          signRequests: saml.authnRequestsSigned === true,
          encryptAssertions: saml.idpMetadata.isAssertionEncrypted === true,
          idpInitiated: saml.idpInitiated === true,
          landingPath: saml.landingPath ?? '/',
          spCertificate: saml.spCertificate
            ? certificateOf(saml.spCertificate)?.fingerprint256
            : null,
        }
      : {}),
    requireSso: row.requireSso,
    showOnSignIn: row.showOnSignIn,
    createAccounts: row.createAccounts,
    defaultGrants: row.defaultGrants,
  };
}
