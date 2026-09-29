import type { NotificationPreferences } from '@manablox/core';
import {
  boolean,
  id,
  index,
  integer,
  json,
  primaryKey,
  table,
  text,
  textId,
  timestamp,
  uniqueIndex,
  uuid,
} from './define.js';
import { spaces } from './spaces.js';

// better-auth owns these tables; declared here so Drizzle can join and migrate them.

export const users = table(
  'users',
  {
    id: id(),
    name: text().notNull().default(''),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /** Instance-wide role; space roles live on `memberships`. */
    role: text().notNull().default('editor'),
    banned: boolean().notNull().default(false),
    banReason: text(),
    /** Set by better-auth's `twoFactor` plugin once a TOTP code was confirmed. */
    twoFactorEnabled: boolean().notNull().default(false),
    /** Per-kind channel overrides; only differences from the defaults. */
    notificationPreferences: json<NotificationPreferences>().notNull().default({}),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = table(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    token: text().notNull(),
    expiresAt: timestamp().notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** The SSO provider that signed this session in; `null` for other sign-ins. */
    ssoProviderId: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_key').on(t.token),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const accounts = table(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    /** Required by better-auth 1.7 for OIDC issuer disambiguation. */
    issuer: text().notNull().default(''),
    accessToken: text(),
    refreshToken: text(),
    accessTokenExpiresAt: timestamp(),
    refreshTokenExpiresAt: timestamp(),
    scope: text(),
    idToken: text(),
    password: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_provider_account_key').on(t.providerId, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

export const verifications = table(
  'verifications',
  {
    /** Text: better-auth keys some rows by a hash, e.g. a used SAML assertion. */
    id: textId(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const apikeys = table(
  'apikeys',
  {
    id: id(),
    name: text(),
    start: text(),
    prefix: text(),
    key: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    enabled: boolean().notNull().default(true),
    expiresAt: timestamp(),
    lastRequest: timestamp(),
    /** Grant restriction; `null` for the owner's role. */
    permissions: json<string[] | null>(),
    /** Space restriction; `null` for all the owner's spaces. */
    spaceIds: json<string[] | null>(),
    /** Environment ids the key may address; `null` for every environment of its spaces. */
    environmentIds: json<string[] | null>(),
    metadata: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('apikeys_user_idx').on(t.userId), index('apikeys_prefix_idx').on(t.prefix)],
);

/** better-auth's `twoFactor` model: the encrypted TOTP secret and backup codes. */
export const twoFactors = table(
  'two_factors',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    /** False until the first code is confirmed. */
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamp(),
  },
  (t) => [uniqueIndex('two_factors_user_key').on(t.userId)],
);

/** A space grant an invitation carries. */
export interface InvitationGrant {
  spaceId: string;
  /** A built-in role or a `roles` machine name in the space. */
  role: string;
}

/** An invitation by email; only a hash of its token is stored. */
export const invitations = table(
  'invitations',
  {
    id: id(),
    email: text().notNull(),
    tokenHash: text().notNull(),
    grants: json<InvitationGrant[]>().notNull().default([]),
    invitedBy: uuid().references(() => users, 'id', { onDelete: 'set null' }),
    expiresAt: timestamp().notNull(),
    acceptedAt: timestamp(),
    acceptedBy: uuid().references(() => users, 'id', { onDelete: 'set null' }),
    revokedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_email_idx').on(t.email),
  ],
);

/**
 * better-auth's `ssoProvider` model plus Manablox's settings. Secrets inside the config JSON are
 * encrypted with the instance secret.
 */
export const ssoProviders = table(
  'sso_providers',
  {
    id: id(),
    /** The slug in the callback, ACS and metadata URLs. */
    providerId: text().notNull(),
    name: text().notNull().default(''),
    /** OIDC issuer or SAML IdP entity id. */
    issuer: text().notNull(),
    /** Comma-separated email domains. */
    domain: text().notNull(),
    oidcConfig: text(),
    samlConfig: text(),
    userId: uuid().references(() => users, 'id', { onDelete: 'set null' }),
    organizationId: text(),
    /** Password sign-in and resets are refused for its domains. */
    requireSso: boolean().notNull().default(false),
    /** Listed as a button on the sign-in page. */
    showOnSignIn: boolean().notNull().default(false),
    /** Unknown addresses get an account at their first sign-in. */
    createAccounts: boolean().notNull().default(true),
    /** Space grants of accounts it creates. */
    defaultGrants: json<InvitationGrant[]>().notNull().default([]),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sso_providers_provider_id_key').on(t.providerId)],
);

/** Per-user admin preferences, one row per key. */
export const userPreferences = table(
  'user_preferences',
  {
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    key: text().notNull(),
    value: json<unknown>().notNull(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey(t.userId, t.key)],
);

/** Space-scoped role assignment. */
export const memberships = table(
  'memberships',
  {
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    /** A built-in role or a `roles` machine name in the same space. */
    role: text().notNull().default('editor'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey(t.userId, t.spaceId), index('memberships_space_idx').on(t.spaceId)],
);

/** A custom space role; grants are broad (`content:read`) or per type (`content:read:<typeId>`). */
export const roles = table(
  'roles',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    name: text().notNull(),
    machineName: text().notNull(),
    description: text(),
    permissions: json<string[]>().notNull().default([]),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_space_machine_name_key').on(t.spaceId, t.machineName)],
);
