import { ManabloxError } from '@manablox/core';
import {
  AI_DEFAULT_SYSTEM_PROMPTS,
  AI_PROVIDERS,
  type AiCapability,
  type AiCustomConfig,
  type AiProviderRef,
  aiProviderRef,
  parseAiProviderRef,
} from '../../../sdk.js';
import type { AiProviderRow, AiRepository } from '../../db/index.js';
import { systemPromptFor } from '../../prompt.js';
import type { ProviderCall } from '../../providers/index.js';
import { decryptSecret, encryptSecret, secretHint } from '../../secrets.js';
import { capabilitiesOf, isUsable, normaliseCustomConfig } from './custom-config.js';
import type { AiProviderView } from './types.js';

/** The fields of a provider call that come from the provider row rather than the request. */
export type ProviderCallBase = Pick<
  ProviderCall,
  'apiKey' | 'model' | 'system' | 'custom' | 'fetch'
>;

export interface ProviderResolverOptions {
  /** Instance secret for encrypting provider keys. */
  secret: string;
  /** Guarded `fetch` for provider calls. */
  fetch?: typeof fetch | undefined;
}

/** Finds a space's providers and turns a row into what a call needs: key, model, system prompt. */
export class AiProviderResolver {
  constructor(
    private readonly store: AiRepository,
    private readonly options: ProviderResolverOptions,
  ) {}

  list(spaceId: string): Promise<AiProviderRow[]> {
    return this.store.listProvidersBySpace(spaceId);
  }

  async require(spaceId: string, ref: AiProviderRef): Promise<AiProviderRow> {
    const { kind, slug } = parseAiProviderRef(ref);
    const row = await this.store.findProviderByKind(spaceId, kind, slug);
    if (!row) throw ManabloxError.notFound('plugins.ai.provider.notFound', { kind: ref });
    return row;
  }

  /** The requested provider, or the space's first usable one. */
  async pick(
    spaceId: string,
    capability: AiCapability,
    ref: AiProviderRef | undefined,
  ): Promise<AiProviderRow> {
    const rows = await this.list(spaceId);
    const usable = rows.filter((row) => isUsable(row) && capabilitiesOf(row).includes(capability));
    if (ref) {
      const chosen = usable.find((row) => aiProviderRef(row.kind, row.slug) === ref);
      if (!chosen) {
        throw ManabloxError.badRequest('plugins.ai.provider.notConfigured', {
          kind: ref,
          capability,
        });
      }
      return chosen;
    }
    // Prefer a hosted provider.
    const first = usable.find((row) => row.kind !== 'custom') ?? usable[0];
    if (!first) throw ManabloxError.badRequest('plugins.ai.provider.notConfigured', { capability });
    return first;
  }

  /** Usable provider refs per capability. */
  async available(spaceId: string): Promise<Record<AiCapability, AiProviderRef[]>> {
    const rows = await this.list(spaceId);
    // Hosted first, matching `pick`.
    const usable = rows
      .filter(isUsable)
      .sort((a, b) => Number(a.kind === 'custom') - Number(b.kind === 'custom'));
    const refsWith = (capability: AiCapability) =>
      usable
        .filter((row) => capabilitiesOf(row).includes(capability))
        .map((row) => aiProviderRef(row.kind, row.slug));
    return { text: refsWith('text'), image: refsWith('image'), video: refsWith('video') };
  }

  present(row: AiProviderRow): AiProviderView {
    return {
      id: row.id,
      ref: aiProviderRef(row.kind, row.slug),
      kind: row.kind,
      slug: row.slug,
      label: this.labelOf(row),
      enabled: row.enabled,
      hasKey: Boolean(row.apiKey),
      apiKeyHint: row.apiKeyHint,
      models: row.models,
      systemPrompt: row.systemPrompt,
      defaults: row.defaults,
      capabilities: capabilitiesOf(row),
      config: row.kind === 'custom' ? normaliseCustomConfig(row.config) : null,
      updatedAt: row.updatedAt,
    };
  }

  labelOf(row: AiProviderRow): string {
    return (
      row.label || (row.kind === 'custom' ? row.slug : AI_PROVIDERS[row.kind]?.label) || row.kind
    );
  }

  /** Key columns for a save: untouched, cleared, or replaced. */
  encodeKey(apiKey: string | null | undefined): {
    apiKey?: string | null;
    apiKeyHint?: string | null;
  } {
    if (apiKey === undefined) return {};
    if (apiKey === null || apiKey === '') return { apiKey: null, apiKeyHint: null };
    return {
      apiKey: encryptSecret(apiKey, this.options.secret),
      apiKeyHint: secretHint(apiKey),
    };
  }

  /** The stored key in plaintext, or null when none is stored. */
  storedKey(row: AiProviderRow): string | null {
    return row.apiKey ? decryptSecret(row.apiKey, this.options.secret) : null;
  }

  keyOf(row: AiProviderRow): string {
    if (!row.apiKey) {
      // A self-hosted server may need no key.
      if (row.kind === 'custom') return '';
      throw ManabloxError.badRequest('plugins.ai.provider.apiKey.required', { kind: row.kind });
    }
    return decryptSecret(row.apiKey, this.options.secret);
  }

  /**
   * The requested model, else the configured one. A requested model must be in the catalogue,
   * unless it is the configured model or the provider is self-hosted.
   */
  resolveModel(
    row: AiProviderRow,
    capability: AiCapability,
    requested: string | undefined,
  ): string {
    const wanted = requested?.trim();
    if (!wanted) return this.modelFor(row, capability);
    if (wanted === row.models?.[capability] || row.kind === 'custom') return wanted;

    const offered = AI_PROVIDERS[row.kind]?.models[capability] ?? [];
    if (offered.some((model) => model.id === wanted)) return wanted;

    throw ManabloxError.badRequest('plugins.ai.provider.model.notOffered', {
      provider: row.kind,
      model: wanted,
      capability,
    });
  }

  modelFor(row: AiProviderRow, capability: AiCapability): string {
    const configured = row.models?.[capability];
    const fallback = AI_PROVIDERS[row.kind]?.defaultModels[capability];
    const model = configured || fallback;
    if (!model) {
      throw ManabloxError.badRequest('plugins.ai.provider.capability.unsupported', {
        provider: row.kind,
        capability,
      });
    }
    return model;
  }

  systemPrompt(row: AiProviderRow): string {
    return systemPromptFor(row.systemPrompt, AI_DEFAULT_SYSTEM_PROMPTS[row.kind] ?? '');
  }

  /** Transport, key and model for a call; the system prompt defaults to the provider's. */
  callBase(row: AiProviderRow, model: string, system?: string): ProviderCallBase {
    return {
      ...this.transport(),
      ...this.customOf(row),
      apiKey: this.keyOf(row),
      model,
      system: system ?? this.systemPrompt(row),
    };
  }

  /** The guarded fetch, when configured. */
  transport(): { fetch?: typeof fetch } {
    return this.options.fetch ? { fetch: this.options.fetch } : {};
  }

  /** A self-hosted provider's config; empty for a hosted one. */
  customOf(row: AiProviderRow): { custom?: AiCustomConfig } {
    return row.kind === 'custom' ? { custom: normaliseCustomConfig(row.config) } : {};
  }
}
