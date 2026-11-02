import { DAY_MS, scopeSpaceId } from '@manablox/core';
import { defineDataProvider, rowsSection } from '@manablox/services';
import type { AiCustomConfig, AiModelMap, AiProviderKind } from '../sdk.js';
import { type AiProviderRow, aiRepos } from './db/index.js';
import { aiKeys } from './keys.js';

/** An AI provider in a space export, without its API key; it arrives disabled. */
export interface ExportedAiProvider {
  id: string;
  kind: AiProviderKind;
  /** Self-hosted provider name; empty for the built-in kinds. */
  slug: string;
  label: string;
  models: AiModelMap;
  systemPrompt: string;
  defaults: Record<string, string>;
  /** A self-hosted provider's endpoint and declared abilities. Never a key. */
  config?: Partial<AiCustomConfig> | undefined;
}

export const toExportedAiProvider = (row: AiProviderRow): ExportedAiProvider => ({
  id: row.id,
  kind: row.kind,
  slug: row.slug,
  label: row.label,
  models: row.models,
  systemPrompt: row.systemPrompt,
  defaults: row.defaults,
  ...(row.kind === 'custom' ? { config: row.config } : {}),
});

/** A provider's identity within its space. */
const refOf = (provider: { kind: string; slug: string }) => `${provider.kind}:${provider.slug}`;

/**
 * The space's providers: transferred without keys,
 * their keys carried over by a snapshot restored on the same instance, and generations pruned
 * by `retention.plugins.ai.generationsDays`. Providers belong to the space, so environments
 * share them.
 */
export const aiProvidersData = defineDataProvider<{ id: string }, ExportedAiProvider>({
  kind: 'ai.providers',
  transfer: {
    section: { label: 'AI providers' },
    ...rowsSection({
      // Providers belong to the space; every environment shares them.
      list: ({ repos }, scope) => aiRepos(repos).listProvidersBySpace(scopeSpaceId(scope)),
      count: ({ repos }, spaceId) => aiRepos(repos).countProvidersBySpace(spaceId),
      label: (row) => row.label,
      toExported: toExportedAiProvider,
    }),
    async import({ repos, spaceId }, entries) {
      const store = aiRepos(repos);
      for (const provider of entries) {
        // Arrives disabled; there is no key.
        await store.upsertProvider({
          ...provider,
          spaceId,
          enabled: false,
          apiKey: null,
          apiKeyHint: null,
        });
      }
    },
  },
  snapshot: {
    // Exports leave keys out; the source's rows still hold them.
    async afterCredentialsRestored({ repos, spaceId, sourceSpaceId, entries }) {
      const store = aiRepos(repos);
      const exported = new Set(entries.map(refOf));
      for (const provider of await store.listProvidersBySpace(sourceSpaceId)) {
        if (!exported.has(refOf(provider))) continue;
        await store.upsertProvider({
          spaceId,
          kind: provider.kind,
          slug: provider.slug,
          enabled: provider.enabled,
          apiKey: provider.apiKey,
          apiKeyHint: provider.apiKeyHint,
        });
      }
    },
  },
  retention: [
    {
      key: aiKeys.retention.generationsDays,
      prune: ({ repos, spaceId, limit }, days) =>
        aiRepos(repos).pruneGenerations({
          spaceId,
          before: new Date(Date.now() - days * DAY_MS),
          limit,
        }),
    },
  ],
});
