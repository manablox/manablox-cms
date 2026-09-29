import type { AuthConfig } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { systemActor } from '@manablox/core/node';
import type { DatabaseHandle, Repositories } from '@manablox/db';
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { bearer, twoFactor } from 'better-auth/plugins';
import { accountPlugin } from './account-plugin.js';
import { type ApiKeyService, parseApiKey } from './api-key.js';
import type { EmailVerificationService } from './email-verification.js';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password.js';
import { type PasswordResetService, RESET_TOKEN_SECONDS, requestDetail } from './password-reset.js';
import type { Principal } from './rbac.js';
import { isSsoPath, type SsoService, withSsoSecrets } from './sso.js';
import type { TwoFactorService } from './two-factor.js';

export * from './api-key.js';
export * from './email-verification.js';
export * from './invitation.service.js';
export * from './mail-sender.js';
export * from './mails.js';
export * from './password.js';
export * from './password-reset.js';
export * from './rbac.js';
export { generateSamlKeys, type SamlKeyPair } from './saml-keys.js';
export * from './sso.js';
export * from './two-factor.js';
export * from './user.service.js';

export type ManabloxAuth = ReturnType<typeof createAuth>;

export interface AuthCallbacks {
  /** Runs after better-auth creates a user row. */
  onUserCreated?: (userId: string) => Promise<void>;
  /** Whether public sign-up may create an account; absent means always. */
  allowSignUp?: () => Promise<boolean>;
  /** Runs after a sign-in. */
  onSessionCreated?: (session: {
    userId: string;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
  }) => Promise<void>;
  /** Password reset by mail and one-time links; without it resets are off. */
  passwordResets?: PasswordResetService | undefined;
  /** Address confirmation links and the sign-in check behind `auth.requireEmailVerification`. */
  emailVerification?: EmailVerificationService | undefined;
  /** The two-factor policy, feature gate, audit and backup-code notices. */
  twoFactor?: TwoFactorService | undefined;
  /** SSO providers, their sign-in rules and the accounts they create. */
  sso?: SsoService | undefined;
}

/** The SSO provider an SSO route serves, from its path. */
const ssoProviderOf = (
  context: { params?: Record<string, string | undefined> | undefined } | null | undefined,
): string | null => context?.params?.providerId ?? null;

/** better-auth wired to the Drizzle schema. */
export function createAuth(
  config: AuthConfig,
  database: Pick<DatabaseHandle, 'kind' | 'db' | 'tables'>,
  callbacks: AuthCallbacks = {},
) {
  const resets = callbacks.passwordResets;
  const sso = callbacks.sso;
  const auth = betterAuth({
    secret: config.secret,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    trustedOrigins: config.trustedOrigins ?? [],
    database: authDatabase(config, database),
    emailAndPassword: emailAndPassword(config, resets),

    session: {
      expiresIn: config.sessionMaxAge ?? 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
      additionalFields: {
        ssoProviderId: { type: 'string', required: false, input: false },
      },
    },

    // Providers are managed through `SsoService`.
    disabledPaths: [
      '/sso/register',
      '/sso/providers',
      '/sso/get-provider',
      '/sso/update-provider',
      '/sso/delete-provider',
    ],

    // `bearer` accepts the session token as an Authorization header. API keys are
    // handled by `ApiKeyService`.
    plugins: [
      bearer(),
      passwordResetStatus(resets),
      accountPlugin({ emails: callbacks.emailVerification, twoFactor: callbacks.twoFactor }),
      // Widened so the auth type stays nameable; its endpoints are reached over HTTP.
      twoFactor({ issuer: 'Manablox' }) as BetterAuthPlugin,
      ...(sso ? sso.plugins() : []),
    ],

    databaseHooks: databaseHooks(callbacks),

    advanced: { database: { generateId: () => crypto.randomUUID() } },
  });
  resets?.bind(auth);
  callbacks.emailVerification?.bind(auth);
  sso?.bind(auth);
  return auth;
}

/** The Drizzle adapter; SSO provider rows carry their client secret encrypted. */
function authDatabase(
  config: AuthConfig,
  database: Pick<DatabaseHandle, 'kind' | 'db' | 'tables'>,
) {
  const { tables } = database;
  return withSsoSecrets(
    drizzleAdapter(database.db, {
      provider: database.kind === 'sqlite' ? 'sqlite' : 'pg',
      schema: {
        user: tables.users,
        session: tables.sessions,
        account: tables.accounts,
        verification: tables.verifications,
        apikey: tables.apikeys,
        twoFactor: tables.twoFactors,
        ssoProvider: tables.ssoProviders,
      },
      // The `sso` plugin resolves users inside a transaction.
      transaction: true,
    }),
    config.secret,
  );
}

/** Password sign-in; resets and their mails when a reset service is given. */
function emailAndPassword(config: AuthConfig, resets: PasswordResetService | undefined) {
  return {
    enabled: config.emailAndPassword ?? true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    password: {
      hash: hashPassword,
      verify: ({ hash: stored, password }) => verifyPassword(stored, password),
    },
    // `/reset-password` also redeems links from `createPasswordSetLink`.
    resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
    revokeSessionsOnPasswordReset: true,
    ...(resets
      ? {
          onPasswordReset: ({ user }, request) => resets.onPasswordReset(user.id, request?.headers),
          ...(resets.mailEnabled
            ? {
                sendResetPassword: ({ user, token }, request) =>
                  resets.onResetRequested(user.id, token, request?.headers),
              }
            : {}),
        }
      : {}),
  } satisfies BetterAuthOptions['emailAndPassword'];
}

/** The sign-up gate, SSO marks and the callbacks around users, accounts and sessions. */
function databaseHooks(callbacks: AuthCallbacks) {
  const sso = callbacks.sso;
  return {
    user: {
      create: {
        // Sign-up and SSO pass here; `UserService` writes admin-created accounts directly.
        before: async (user, context) => {
          // `SsoService.resolveUser` admitted it; the provider vouches for the address.
          if (isSsoPath(context?.path)) return { data: { ...user, emailVerified: true } };
          if (!callbacks.allowSignUp || (await callbacks.allowSignUp())) return { data: user };
          throw new APIError('FORBIDDEN', { message: 'auth.signUp.closed' });
        },
        after: async (user, context) => {
          await callbacks.onUserCreated?.(user.id);
          const providerId = isSsoPath(context?.path) ? ssoProviderOf(context) : null;
          if (providerId) {
            await sso?.accountCreated(user.id, providerId, context?.request?.headers);
          }
        },
      },
      update: {
        // The `twoFactor` plugin flips the flag on these two paths only.
        after: async (user, context) => {
          const path = context?.path;
          if (path !== '/two-factor/verify-totp' && path !== '/two-factor/disable') return;
          await callbacks.twoFactor?.changed(
            user.id,
            path === '/two-factor/verify-totp',
            context?.request?.headers,
          );
        },
      },
    },
    account: {
      create: {
        after: async (account, context) => {
          if (!sso || !isSsoPath(context?.path)) return;
          await sso.accountAdded(account.userId, account.providerId, context?.request?.headers);
        },
      },
    },
    session: {
      create: {
        // Marks SSO sessions; the two-factor policy covers password sign-ins only.
        before: async (session, context) => {
          const providerId = isSsoPath(context?.path) ? ssoProviderOf(context) : null;
          return providerId
            ? { data: { ...session, ssoProviderId: providerId } }
            : { data: session };
        },
        after: async (session) => {
          await callbacks.onSessionCreated?.(session);
        },
      },
    },
  } satisfies BetterAuthOptions['databaseHooks'];
}

/** `GET /password-reset/status`: whether the sign-in page offers "forgot password". */
function passwordResetStatus(resets: PasswordResetService | undefined) {
  return {
    id: 'manablox-password-reset',
    endpoints: {
      passwordResetStatus: createAuthEndpoint(
        '/password-reset/status',
        { method: 'GET' },
        async (ctx) => ctx.json({ enabled: resets?.mailEnabled ?? false }),
      ),
    },
  } satisfies BetterAuthPlugin;
}

/** The public prefix of a refused key, never the secret. */
function keyHint(presented: string): string {
  const parsed = parseApiKey(presented);
  return parsed ? parsed.prefix : 'unparseable';
}

/**
 * Resolves a request into a `Principal`, or `null` when anonymous. A password session the
 * two-factor policy covers without two-factor resolves with no grants and `twoFactorPending`.
 */
export async function resolvePrincipal(
  auth: ManabloxAuth,
  repos: Repositories,
  headers: Headers,
  apiKeys?: ApiKeyService,
  twoFactorPolicy?: Pick<TwoFactorService, 'pending'>,
): Promise<Principal | null> {
  // `x-api-key` takes precedence over the session.
  const presented = headers.get('x-api-key');
  if (presented && apiKeys) {
    const principal = await apiKeys.resolve(presented);
    if (principal) return principal;
    // Audit refused keys; `record` never throws and is not awaited.
    void repos.audit.record({
      actor: { kind: 'system', id: null, label: 'api key', detail: requestDetail(headers) },
      action: 'apiKey.rejected',
      targetKind: 'apiKey',
      targetId: null,
      targetLabel: keyHint(presented),
    });
  }

  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;

  // Read from the database, not the session cache, so permission changes apply immediately.
  const principal = await repos.users.findPrincipal(session.user.id);
  if (!principal || principal.banned) return null;

  const viaSso = Boolean(
    (session.session as { ssoProviderId?: string | null } | undefined)?.ssoProviderId,
  );
  if (!viaSso && (await twoFactorPolicy?.pending(principal))) {
    return {
      userId: session.user.id,
      email: session.user.email,
      role: 'editor',
      spaces: {},
      permissions: {},
      twoFactorPending: true,
    };
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    role: principal.role,
    spaces: principal.spaces,
    permissions: principal.permissions,
  };
}

/** Makes the sole account a `superadmin` owning every space. */
export async function promoteFirstUser(
  manablox: Manablox,
  repos: Repositories,
  userId: string,
): Promise<void> {
  const count = await repos.users.count();
  if (count !== 1) return;

  const user = await repos.users.findById(userId);
  if (!user || user.role === 'superadmin') return;

  await repos.users.setRole(userId, 'superadmin');
  await ownEverySpace(manablox, repos, userId);
  await repos.audit.record({
    actor: systemActor('first account'),
    action: 'user.promote',
    targetKind: 'user',
    targetId: user.id,
    targetLabel: user.email,
    changes: [{ path: 'role', from: user.role, to: 'superadmin' }],
  });

  manablox.logger.info({ email: user.email }, 'first account promoted to superadmin');
}

/**
 * Makes the first account owner of every space, with `member:beforeGrant` and `seat.changed`
 * as any grant; a space whose hook refuses is skipped and logged.
 */
export async function ownEverySpace(
  manablox: Manablox,
  repos: Repositories,
  userId: string,
): Promise<void> {
  for (const space of await repos.spaces.list()) {
    const previous = await repos.users.findSpaceRole(userId, space.id);
    if (previous === 'owner') continue;
    try {
      await manablox.hooks.run(
        'member:beforeGrant',
        { spaceId: space.id, userId, role: 'owner', previous },
        { manablox, spaceId: space.id },
      );
    } catch (error) {
      manablox.logger.warn(
        { err: error, spaceId: space.id, userId },
        'first account not made owner',
      );
      continue;
    }
    await repos.transaction(async (tx) => {
      await tx.users.grant(userId, space.id, 'owner');
      if (previous) return;
      await manablox.controls.emit(
        'seat.changed',
        { kind: 'space', id: space.id },
        {
          spaceId: space.id,
          change: 'added',
          userIds: [userId],
          members: await tx.limitCounts.seats([space.id]),
        },
        { tx },
      );
    });
  }
}

/** Promotes a sole existing account at startup, unless `provisioned` answers true. */
export function attachBootstrapOwner(
  manablox: Manablox,
  repos: Repositories,
  options: { provisioned?: () => Promise<boolean> } = {},
): void {
  manablox.hooks.on(
    'after:start',
    async () => {
      if (await options.provisioned?.()) return;
      const { items } = await repos.users.page({ limit: 1, offset: 0 });
      const first = items[0];
      if (first && (await repos.users.count()) === 1) {
        await promoteFirstUser(manablox, repos, first.id);
      }
    },
    { source: '@manablox/auth' },
  );
}
