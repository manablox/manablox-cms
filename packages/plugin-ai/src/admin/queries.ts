import {
  api,
  invalidate,
  type SpaceRef,
  useSpacePagedQuery,
  useSpaceQuery,
} from '@manablox/admin-sdk';
import { useQuery } from '@tanstack/vue-query';
import type { AiProviderRef } from '../sdk';
import { aiApi } from './client';
import { aiKeys, invalidateAi } from './keys';

/** A provider of the space as the admin lists it; keys are never read back. */
export type AiProvider = Awaited<ReturnType<typeof aiApi.providers>>[number];
/** One generation row, for polling image or video jobs. */
export type AiGeneration = Awaited<ReturnType<typeof aiApi.generation>>;

/** Provider metadata and style pickers, as the server uses them. */
export function useAiCatalog() {
  return useQuery({
    queryKey: aiKeys.catalog(),
    // Changes only with a release.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => aiApi.catalog(),
  });
}

export function useAiProviders(spaceId?: SpaceRef) {
  return useSpaceQuery(aiKeys.providers, (id) => aiApi.providers({ spaceId: id }), { spaceId });
}

/** Capabilities this space can generate; wand buttons hide without them. */
export function useAiAvailable(spaceId?: SpaceRef) {
  return useSpaceQuery(aiKeys.available, (id) => aiApi.available({ spaceId: id }), { spaceId });
}

/** The space's length presets. */
export function useAiSettings(spaceId?: SpaceRef) {
  return useSpaceQuery(aiKeys.settings, (id) => aiApi.settings({ spaceId: id }), { spaceId });
}

/** Generations per page on the AI tab. */
const AI_GENERATIONS_PAGE_SIZE = 20;

/** The space's generations, newest first, a page at a time. */
export function useAiGenerations(spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (id, page) => aiKeys.generations(id, { page }),
    (id, pagination) => aiApi.generations({ spaceId: id, pagination }),
    { spaceId, pageSize: AI_GENERATIONS_PAGE_SIZE },
  );
}

type SettingsInput = Parameters<typeof aiApi.saveSettings>[0];
type ProviderInput = Parameters<typeof aiApi.saveProvider>[0];

/** Provider and settings writes, each with its invalidation. */
export const aiProviders = {
  async save(input: ProviderInput) {
    const saved = await aiApi.saveProvider(input);
    invalidateAi(input.spaceId);
    return saved;
  },
  async remove(spaceId: string, ref: AiProviderRef) {
    await aiApi.deleteProvider({ spaceId, kind: ref });
    invalidateAi(spaceId);
  },
  /** A test call through the stored settings; writes nothing. */
  test: (spaceId: string, ref: AiProviderRef) => aiApi.testProvider({ spaceId, kind: ref }),
  async saveSettings(input: SettingsInput) {
    const saved = await aiApi.saveSettings(input);
    invalidateAi(input.spaceId);
    return saved;
  },
};

type TextInput = Parameters<typeof aiApi.generateText>[0];
type MediaInput = Parameters<typeof aiApi.generateMedia>[0];
type DocumentInput = Parameters<typeof aiApi.generateDocument>[0];
type TypeDesignInput = Parameters<typeof aiApi.designContentTypes>[0];
type TemplateDesignInput = Parameters<typeof aiApi.designTemplate>[0];
type PlanInput = Parameters<typeof api.contentTypes.applyPlan>[0];

/** Generation calls. Actions, not queries: each costs money, so nothing refetches. */
export const ai = {
  text: (input: TextInput) => aiApi.generateText(input),
  media: (input: MediaInput) => aiApi.generateMedia(input),
  document: (input: DocumentInput) => aiApi.generateDocument(input),
  /** A content type plan; writes nothing. */
  designTypes: (input: TypeDesignInput) => aiApi.designContentTypes(input),
  /** A template's blocks and needed block types; writes nothing. */
  designTemplate: (input: TemplateDesignInput) => aiApi.designTemplate(input),
  /** Creates a plan's types and refreshes the model. */
  async applyPlan(input: PlanInput) {
    const created = await api.contentTypes.applyPlan(input);
    await invalidate.contentTypes(input.spaceId);
    return created;
  },
  /** One generation, for polling image or video jobs. */
  generation: (spaceId: string, id: string) => aiApi.generation({ spaceId, id }),
  /** A finished generation's asset, with its URL. */
  async asset(spaceId: string, assetId: string) {
    const [asset] = await api.assets.getMany({ spaceId, ids: [assetId] });
    return asset ?? null;
  },
};
