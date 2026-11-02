import {
  assets,
  boolean,
  id,
  index,
  json,
  spaces,
  table,
  text,
  timestamp,
  unique,
  uuid,
} from '@manablox/db/definitions';
import type {
  AiCustomConfig,
  AiGenerationKind,
  AiGenerationStatus,
  AiModelMap,
  AiProviderKind,
} from '../../sdk.js';

/**
 * A space's AI provider, one per kind (self-hosted ones told apart by `slug`). Only the
 * plugin's services decrypt the key.
 */
export const aiProviders = table(
  'ai_providers',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    kind: text<AiProviderKind>().notNull(),
    /** Names a self-hosted provider; empty for hosted ones. */
    slug: text().notNull().default(''),
    label: text().notNull().default(''),
    enabled: boolean().notNull().default(false),
    /** AES-256-GCM ciphertext of the API key; null until set. */
    apiKey: text(),
    /** Last four characters of the key. */
    apiKeyHint: text(),
    /** Capability -> model id, free text. */
    models: json<AiModelMap>().notNull().default({}),
    /** Prepended to every generation. */
    systemPrompt: text().notNull().default(''),
    /** Dialog defaults: style group id -> option id. */
    defaults: json<Record<string, string>>().notNull().default({}),
    /** Self-hosted endpoint and capabilities; empty for hosted ones. */
    config: json<Partial<AiCustomConfig>>().notNull().default({}),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique('ai_providers_space_kind_slug_key').on(t.spaceId, t.kind, t.slug)],
);

/** Every generation requested; media jobs are polled through this row. */
export const aiGenerations = table(
  'ai_generations',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    providerId: uuid().references(() => aiProviders, 'id', { onDelete: 'set null' }),
    providerKind: text<AiProviderKind>().notNull(),
    kind: text<AiGenerationKind>().notNull(),
    status: text<AiGenerationStatus>().notNull().default('pending'),
    model: text().notNull().default(''),
    /** The raw prompt, before styles and system prompt. */
    prompt: text().notNull(),
    /** Style group id -> option id, plus dialog context. */
    options: json<Record<string, unknown>>().notNull().default({}),
    /** Text or a field map; null until done. */
    result: json<Record<string, unknown>>(),
    /** The produced image or video asset. */
    assetId: uuid().references(() => assets, 'id', { onDelete: 'set null' }),
    /** Translatable error key. */
    error: text(),
    /** Provider, status and provider message behind `error`. */
    errorDetail: json<Record<string, unknown>>(),
    actorId: uuid(),
    createdAt: timestamp().notNull().defaultNow(),
    finishedAt: timestamp(),
  },
  (t) => [
    index('ai_generations_space_idx').on(t.spaceId, t.createdAt),
    index('ai_generations_status_idx').on(t.status),
  ],
);
