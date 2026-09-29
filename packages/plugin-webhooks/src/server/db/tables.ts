import type { ResourceSource, SignatureAlgorithm, SignatureFormat } from '@manablox/core';
import {
  boolean,
  credentials,
  environmentId,
  id,
  index,
  integer,
  json,
  spaces,
  table,
  text,
  timestamp,
  unique,
  uuid,
} from '@manablox/db/definitions';
import type {
  WebhookAuthMode,
  WebhookDirection,
  WebhookMethod,
  WebhookPayload,
} from '../../sdk.js';

/**
 * An outgoing (`url`, `events`) or incoming (`slug`, `methods`) endpoint. Secrets live in
 * core's vault behind `credentialId`.
 */
export const webhooks = table(
  'webhooks',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    direction: text<WebhookDirection>().notNull().default('outgoing'),
    name: text().notNull(),
    /** Last segment of an incoming URL; unique per space and direction. */
    slug: text().notNull().default(''),
    /** `code` rows are reconciled from the config and read-only elsewhere. */
    source: text<ResourceSource>().notNull().default('runtime'),
    /** Which plugin declared it, or `config`. */
    sourceRef: text(),
    description: text(),
    /** Outgoing only. */
    url: text().notNull().default(''),
    /** Outgoing: subscribed content events; empty means all. */
    events: json<string[]>().notNull().default([]),
    /** Outgoing: extra headers on every call. */
    headers: json<Array<{ name: string; value: string }>>().notNull().default([]),
    /** Incoming: accepted methods. */
    methods: json<WebhookMethod[]>().notNull().default([]),
    authMode: text<WebhookAuthMode>().notNull().default('none'),
    /** `set null`: deleting a credential disables its endpoints rather than deleting them. */
    credentialId: uuid().references(() => credentials, 'id', { onDelete: 'set null' }),
    signatureHeader: text().notNull().default('x-manablox-signature'),
    algorithm: text<SignatureAlgorithm>().notNull().default('sha256'),
    signatureFormat: text<SignatureFormat>().notNull().default('prefixed'),
    enabled: boolean().notNull().default(true),
    /** Last call in either direction. */
    lastUsedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('webhooks_space_idx').on(t.spaceId, t.direction, t.enabled),
    unique('webhooks_environment_direction_slug_key').on(t.environmentId, t.direction, t.slug),
  ],
);

/** One call over an endpoint, rejected ones included; `payload` and `status` follow `direction`. */
export const webhookDeliveries = table(
  'webhooks_deliveries',
  {
    id: id(),
    webhookId: uuid()
      .notNull()
      .references(() => webhooks, 'id', { onDelete: 'cascade' }),
    spaceId: uuid().references(() => spaces, 'id', { onDelete: 'cascade' }),
    direction: text<WebhookDirection>().notNull().default('outgoing'),
    event: text().notNull(),
    payload: json<Record<string, unknown> | WebhookPayload>().notNull(),
    /** Lower-cased request headers, secret-bearing ones removed. */
    headers: json<Record<string, string>>().notNull().default({}),
    status: integer(),
    error: text(),
    attempt: integer().notNull().default(1),
    ms: integer(),
    /** Incoming: workflow runs this call started. */
    runIds: json<string[]>().notNull().default([]),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('webhooks_deliveries_webhook_idx').on(t.webhookId, t.createdAt)],
);
