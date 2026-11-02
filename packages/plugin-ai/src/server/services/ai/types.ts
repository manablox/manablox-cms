import type { BlockGridValue, BlockValue, FieldItem } from '@manablox/core';
import type {
  AiCapability,
  AiCustomConfig,
  AiLengthPreset,
  AiLengthTarget,
  AiModelMap,
  AiProviderKind,
  AiProviderRef,
} from '../../../sdk.js';
import type { AiGenerationRow } from '../../db/index.js';
import type { AiRequestContext } from '../../prompt.js';

/** A provider as the admin sees it: everything but the key. */
export interface AiProviderView {
  id: string;
  /** How a request names it: the kind, or `custom:<slug>`. */
  ref: AiProviderRef;
  kind: AiProviderKind;
  slug: string;
  label: string;
  enabled: boolean;
  /** Whether a key is stored; the key never leaves the server. */
  hasKey: boolean;
  apiKeyHint: string | null;
  models: AiModelMap;
  systemPrompt: string;
  defaults: Record<string, string>;
  capabilities: readonly AiCapability[];
  /** Self-hosted endpoint and abilities; null for a hosted provider. */
  config: AiCustomConfig | null;
  updatedAt: Date;
}

export interface AiProviderSaveInput {
  kind: AiProviderKind;
  /** Required for a self-hosted provider. */
  slug?: string | undefined;
  label?: string | undefined;
  enabled?: boolean | undefined;
  /** Plaintext key. `undefined` keeps the stored one, `null` removes it. */
  apiKey?: string | null | undefined;
  models?: AiModelMap | undefined;
  systemPrompt?: string | undefined;
  defaults?: Record<string, string> | undefined;
  /** Self-hosted endpoint and abilities; ignored for a hosted provider. */
  config?: Partial<AiCustomConfig> | undefined;
}

/** Space-level generation settings. */
export interface AiSpaceSettings {
  /** Length presets, in display order. */
  lengths: AiLengthPreset[];
}

export interface AiGenerateInput {
  spaceId: string;
  /** Defaults to the space's first usable provider for the job. */
  providerKind?: AiProviderRef | undefined;
  /** Overrides the provider's configured model for this generation. */
  model?: string | undefined;
  prompt: string;
  /** Style group id -> option id. */
  styles?: Record<string, string> | undefined;
  /** Exact length overriding the `length` style preset. */
  length?: AiLengthTarget | undefined;
  context?: AiRequestContext | undefined;
  actorId?: string | null | undefined;
}

export interface AiDocumentInput extends AiGenerateInput {
  contentTypeId: string;
  locale?: string | null | undefined;
  /** Allowed block type ids; empty or absent allows all. */
  blockTypes?: string[] | undefined;
  /** False skips all images. */
  images?: boolean | undefined;
  audience?: string | undefined;
  keywords?: string[] | undefined;
}

export interface AiTextResult {
  generation: AiGenerationRow;
  text: string;
}

/** An image brief written by the text model, drawn later by the image model. */
export interface AiDocumentImage {
  /** An asset field or a block field. */
  field: string;
  /** Set when the image belongs to a block. */
  blockId?: string | undefined;
  blockField?: string | undefined;
  label: string;
  prompt: string;
  /** Requested ratio, when it is one the picker offers. */
  aspectRatio?: string | undefined;
}

export interface AiDocumentResult {
  generation: AiGenerationRow;
  /** Field name -> value. Rich text is HTML. */
  fields: Record<string, string>;
  /** Block field name -> blocks in reading order; values are strings, rich text as HTML. */
  blocks: Record<string, BlockValue[]>;
  /** Block field name -> grid. */
  grids: Record<string, BlockGridValue>;
  /** Repeater field name -> items; sub-field values are strings, rich text as HTML. */
  items: Record<string, FieldItem[]>;
  /** All requested images, in document order. */
  images: AiDocumentImage[];
}

/** Input for a checked structured generation. */
export interface AiDesignJsonInput<T> {
  spaceId: string;
  providerKind?: AiProviderRef | undefined;
  model?: string | undefined;
  /** Full instruction; a rejected answer's problems are appended on retry. */
  prompt: string;
  system: string;
  /** History label, e.g. `content types`, `workflow`. */
  purpose: string;
  actorId?: string | null | undefined;
  /** Parses an answer and lists its problems; the last answer is returned when retries run out. */
  check: (answer: Record<string, unknown>) => Promise<{ value: T; problems: string[] }>;
  maxTokens?: number | undefined;
}

export interface AiServiceOptions {
  /** Instance secret for encrypting provider keys. */
  secret: string;
  /** Enqueues a media generation job; runs inline when absent. */
  enqueue?: ((generationId: string, spaceId: string) => Promise<void>) | undefined;
  /** Guarded `fetch` for provider calls; video downloads use provider-chosen URLs. */
  fetch?: typeof fetch | undefined;
  /** Retries for a design answer with problems. */
  designRetries?: number | undefined;
}
