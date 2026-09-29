import {
  getCurrentRequestState,
  getRequestStateAsyncLocalStorage,
  type RequestStateWeakMap,
} from '@better-auth/core/context';
import { type SSOUserResolution, type SSOUserResolutionInput, sso } from '@better-auth/sso';
import { auditor, diffRecords, ManabloxError } from '@manablox/core';
import { type Manablox, systemActor } from '@manablox/core/node';
import type { Repositories, SsoProviderRow } from '@manablox/db';
import type { BetterAuthPlugin } from 'better-auth';
import type { InvitationSpaces } from './invitation.service.js';
import { requestDetail } from './password-reset.js';
import { adminUrl, baseUrl, invalid, type SsoAuthContext, type SsoContext } from './sso/context.js';
import { domainOf, emailInDomains } from './sso/domains.js';
import { discover, discoveryMessage } from './sso/oidc.js';
import { ssoRules } from './sso/rules.js';
import { withSpKeys } from './sso/saml.js';
import { providerIdOf, providerSettings } from './sso/settings.js';
import { certificateOf, parseJson, type StoredSaml } from './sso/stored.js';
import type {
  SsoOidcInput,
  SsoProviderInput,
  SsoProviderList,
  SsoProviderView,
  SsoSamlInput,
  SsoSettingsInput,
  SsoSignInProvider,
  SsoTestResult,
} from './sso/types.js';
import { providerViews, summary } from './sso/views.js';
import { userAuditor } from './user.service.js';

export { emailInDomains } from './sso/domains.js';
export { withSsoSecrets } from './sso/secrets.js';
export * from './sso/types.js';

/** What the ACS needs to know about its provider before the plugin runs. */
interface AcsSettings {
  idpInitiated: boolean;
  /** Where IdP-initiated sign-ins, and refusals without a sign-in page to return to, land. */
  landingUrl: string;
}

/** Request-state key of the ACS settings. */
const ACS_SETTINGS = Object.freeze({});

/** better-auth's SSO routes: sign-in callbacks, the ACS and the metadata. */
export const isSsoPath = (path: string | undefined): boolean =>
  typeof path === 'string' && path.startsWith('/sso/');

/**
 * SSO providers (OIDC and SAML) the superadmin configures, on better-auth's `sso` plugin: which
 * domains they serve, whether those must use them, and what accounts they create. Gated by the
 * `sso` feature; switched off, providers stay stored but nobody signs in through them.
 */
export class SsoService {
  private context: (() => Promise<SsoAuthContext>) | null = null;
  private readonly created = new Set<string>();
  private requestStates: { getStore(): RequestStateWeakMap | undefined } | null = null;
  private readonly ctx: SsoContext;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly deps: { spaces: Pick<InvitationSpaces, 'addMembers'>; secret: string },
  ) {
    this.ctx = { manablox, repos, secret: deps.secret, auth: () => this.requireContext() };
  }

  /** Called by `createAuth`. */
  bind(auth: { $context: Promise<SsoAuthContext> }): void {
    this.context = () => auth.$context;
  }

  /** Whether the `sso` feature is on. */
  async available(): Promise<boolean> {
    return (await this.manablox.controls.feature(null, 'sso')).enabled;
  }

  async list(): Promise<SsoProviderList> {
    const [rows, authBaseUrl] = await Promise.all([
      this.repos.ssoProviders.list(),
      baseUrl(this.ctx),
    ]);
    return { providers: await providerViews(this.ctx, rows), authBaseUrl };
  }

  async get(id: string): Promise<SsoProviderView> {
    return (await providerViews(this.ctx, [await this.require(id)]))[0] as SsoProviderView;
  }

  async create(input: SsoProviderInput): Promise<SsoProviderView> {
    await this.manablox.controls.assertFeature(null, 'sso');
    const providerId = await providerIdOf(this.ctx, input.providerId);
    const data = await providerSettings(this.ctx, providerId, input, null);
    const row = await this.repos.ssoProviders.create({ providerId, ...data });
    await this.audit().record('ssoProvider.create', row, diffRecords(null, summary(row)));
    return this.get(row.id);
  }

  async update(id: string, input: SsoSettingsInput): Promise<SsoProviderView> {
    await this.manablox.controls.assertFeature(null, 'sso');
    const before = await this.require(id);
    const data = await providerSettings(this.ctx, before.providerId, input, before);
    const row = await this.repos.ssoProviders.update(id, data);
    if (!row) throw ManabloxError.notFound('sso.notFound', { id });
    const secretChanged = Boolean(input.oidc?.clientSecret);
    await this.audit().record(
      'ssoProvider.update',
      row,
      diffRecords(summary(before), summary(row)),
      secretChanged ? { clientSecretChanged: true } : null,
    );
    return this.get(row.id);
  }

  /** Signed-in accounts keep their sessions; their links to the provider are removed. */
  async delete(id: string): Promise<void> {
    const row = await this.require(id);
    await this.repos.transaction(async (tx) => {
      await tx.ssoProviders.unlinkAccounts(row.providerId);
      await tx.ssoProviders.delete(id);
      await this.audit()
        .in(tx)
        .record('ssoProvider.delete', row, diffRecords(summary(row), null));
    });
  }

  /** A new SP key pair for a SAML provider; the old one stops working at once. */
  async regenerateKeys(id: string): Promise<SsoProviderView> {
    await this.manablox.controls.assertFeature(null, 'sso');
    const before = await this.require(id);
    const stored = parseJson<StoredSaml>(before.samlConfig);
    if (!stored) throw invalid([{ key: 'sso.protocol.required', path: ['saml'] }]);
    const saml = await withSpKeys(this.ctx, before.providerId, stored, null);
    const row = await this.repos.ssoProviders.update(id, { samlConfig: JSON.stringify(saml) });
    if (!row) throw ManabloxError.notFound('sso.notFound', { id });
    await this.audit().record(
      'ssoProvider.update',
      row,
      diffRecords(summary(before), summary(row)),
      { spKeysRegenerated: true },
    );
    return this.get(row.id);
  }

  /** OIDC: fetches the discovery document. SAML: reads the certificate. */
  async test(input: {
    oidc?: Pick<SsoOidcInput, 'issuer' | 'discoveryEndpoint'> | undefined;
    saml?: Pick<SsoSamlInput, 'certificate'> | undefined;
  }): Promise<SsoTestResult> {
    await this.manablox.controls.assertFeature(null, 'sso');
    if (input.saml) {
      const certificate = certificateOf(input.saml.certificate);
      if (!certificate) return { ok: false, message: 'The certificate cannot be read.' };
      return {
        ok: true,
        protocol: 'saml',
        subject: certificate.subject,
        expiresAt: new Date(certificate.validTo),
        fingerprint: certificate.fingerprint256,
      };
    }
    if (!input.oidc) return { ok: false, message: 'Nothing to test.' };
    try {
      const found = await discover(this.ctx, input.oidc.issuer, input.oidc.discoveryEndpoint);
      return {
        ok: true,
        protocol: 'oidc',
        authorizationEndpoint: found.authorizationEndpoint,
        tokenEndpoint: found.tokenEndpoint,
        userInfoEndpoint: found.userInfoEndpoint ?? null,
      };
    } catch (error) {
      return { ok: false, message: discoveryMessage(error) };
    }
  }

  /** Providers listed on the sign-in page; none while the feature is off. */
  async signInProviders(): Promise<SsoSignInProvider[]> {
    if (!(await this.available())) return [];
    const rows = await this.repos.ssoProviders.list();
    return rows
      .filter((row) => row.showOnSignIn)
      .map((row) => ({ providerId: row.providerId, name: row.name }));
  }

  /** The provider for an address, and whether it must be used; `null` while the feature is off. */
  async lookup(email: string): Promise<(SsoSignInProvider & { required: boolean }) | null> {
    const row = await this.providerFor(email);
    return row ? { providerId: row.providerId, name: row.name, required: row.requireSso } : null;
  }

  /** Whether password sign-in and resets are refused for an address. */
  async requiredFor(email: string): Promise<boolean> {
    return (await this.providerFor(email))?.requireSso === true;
  }

  /**
   * better-auth's `resolveUser`, run in the sign-in transaction, so it only reads. The address
   * must be in the provider's domains; an account bound to the identity, or else one with the
   * address, is signed in; otherwise one is created when the provider allows it and seats remain.
   */
  async resolveUser(input: SSOUserResolutionInput): Promise<SSOUserResolution> {
    const email = input.providerUser.email.trim().toLowerCase();
    const refuse = (code: string, message: string, reason: string): SSOUserResolution => {
      this.refused(email, input.providerId, reason);
      return { action: 'reject', code, message };
    };
    if (!(await this.available())) return refuse('sso_disabled', 'auth.sso.disabled', 'feature');
    const provider = await this.repos.ssoProviders.findByProviderId(input.providerId);
    if (!provider) return refuse('sso_unknown', 'auth.sso.unknown', 'provider');
    if (!emailInDomains(email, provider.domain)) {
      return refuse('sso_domain', 'auth.sso.domain', 'domain');
    }
    const ownerId = await this.repos.ssoProviders.accountOwner(
      provider.providerId,
      input.accountKey.accountId,
    );
    const user = ownerId
      ? await this.repos.users.findById(ownerId)
      : await this.repos.users.findByEmail(email);
    if (user) {
      if (user.banned) return refuse('sso_banned', 'auth.sso.banned', 'banned');
      return { action: 'link', userId: user.id, profile: 'preserve' };
    }
    if (!provider.createAccounts) return refuse('sso_no_account', 'auth.sso.noAccount', 'account');
    try {
      await this.manablox.controls.assertLimit(null, 'seats');
      for (const grant of provider.defaultGrants) {
        if (await this.repos.spaces.findById(grant.spaceId)) {
          await this.manablox.controls.assertLimit(grant.spaceId, 'seats');
        }
      }
    } catch (error) {
      if (error instanceof ManabloxError && error.key === 'control.limit') {
        return refuse('sso_seats', 'auth.sso.seats', 'seats');
      }
      throw error;
    }
    return { action: 'continue' };
  }

  /** After an account was created at an SSO sign-in: audit and the provider's space grants. */
  async accountCreated(userId: string, providerId: string, headers?: Headers): Promise<void> {
    this.created.add(userId);
    const [user, provider] = await Promise.all([
      this.repos.users.findById(userId),
      this.repos.ssoProviders.findByProviderId(providerId),
    ]);
    if (!user) return;
    const actor = systemActor('single sign-on', requestDetail(headers));
    await userAuditor(this.repos, actor).record(
      'user.create',
      user,
      diffRecords(null, { name: user.name, email: user.email, role: user.role }),
      { via: 'sso', providerId },
    );
    for (const grant of provider?.defaultGrants ?? []) {
      try {
        await this.deps.spaces.addMembers(grant.spaceId, [userId], grant.role, { mail: false });
      } catch (error) {
        this.manablox.logger.warn(
          { err: error, userId, spaceId: grant.spaceId },
          'SSO default grant not given',
        );
      }
    }
  }

  /** After an SSO identity was added to an account: audited as a link unless the account is new. */
  async accountAdded(userId: string, providerId: string, headers?: Headers): Promise<void> {
    if (this.created.delete(userId)) return;
    const user = await this.repos.users.findById(userId);
    if (!user) return;
    const actor = systemActor('single sign-on', requestDetail(headers));
    // The provider vouches for addresses in its domains.
    const verified = user.emailVerified
      ? user
      : await this.repos.users.update(user.id, { emailVerified: true });
    await userAuditor(this.repos, actor).record(
      'user.linkSso',
      verified,
      user.emailVerified ? [] : [{ path: 'emailVerified', from: false, to: true }],
      { providerId },
    );
  }

  /** Read by the ACS hook before the plugin handles a SAML response. */
  async acsSettings(providerId: string | undefined): Promise<AcsSettings> {
    const row = providerId ? await this.repos.ssoProviders.findByProviderId(providerId) : null;
    const saml = parseJson<StoredSaml>(row?.samlConfig ?? null);
    const idpInitiated = saml?.idpInitiated === true;
    return {
      idpInitiated,
      landingUrl: adminUrl(this.ctx, idpInitiated ? (saml?.landingPath ?? '/') : '/login'),
    };
  }

  /** Keeps the ACS settings in better-auth's per-request state. */
  async rememberAcs(settings: AcsSettings): Promise<void> {
    this.requestStates ??= await getRequestStateAsyncLocalStorage();
    (await getCurrentRequestState()).set(ACS_SETTINGS, settings);
  }

  /** better-auth's `sso` plugin and the Manablox rules around it. */
  plugins(): BetterAuthPlugin[] {
    const acs = () => this.requestStates?.getStore()?.get(ACS_SETTINGS) as AcsSettings | undefined;
    return [
      sso({
        resolveUser: (input) => this.resolveUser(input),
        // Providers are managed through `SsoService`, never by users.
        providersLimit: 0,
        // Read per response: unsolicited responses only for providers that accept them.
        saml: {
          get allowIdpInitiated() {
            return acs()?.idpInitiated === true;
          },
          get requireTimestamps() {
            return acs()?.idpInitiated === true;
          },
          get idpInitiatedCallbackUrl() {
            return acs()?.landingUrl;
          },
        },
      }) as unknown as BetterAuthPlugin,
      ssoRules(this),
    ];
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async providerFor(email: string): Promise<SsoProviderRow | null> {
    if (!domainOf(email) || !(await this.available())) return null;
    const rows = (await this.repos.ssoProviders.list()).filter((row) =>
      emailInDomains(email, row.domain),
    );
    return rows.find((row) => row.requireSso) ?? rows[0] ?? null;
  }

  /** Audits a refused SSO sign-in; not awaited, as the sign-in transaction is still open. */
  private refused(email: string, providerId: string, reason: string): void {
    void this.repos.audit.record({
      actor: systemActor('single sign-on'),
      action: 'session.signInFailed',
      targetKind: 'session',
      targetId: null,
      targetLabel: email,
      meta: { reason: `sso.${reason}`, providerId },
    });
  }

  private audit() {
    return auditor(this.repos, 'ssoProvider', (row: SsoProviderRow) => row.name);
  }

  private async require(id: string): Promise<SsoProviderRow> {
    const row = await this.repos.ssoProviders.findById(id);
    if (!row) throw ManabloxError.notFound('sso.notFound', { id });
    return row;
  }

  private async requireContext(): Promise<SsoAuthContext> {
    if (!this.context) throw new Error('SsoService is not bound to an auth instance.');
    return this.context();
  }
}
