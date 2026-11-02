import { type PluginRouterOf, type PluginRpcKit, schemas } from '@manablox/api-rpc/plugin';
import { assertCan } from '@manablox/auth';
import { z } from 'zod';
import {
  AI_CUSTOM_APIS,
  AI_CUSTOM_SLUG_PATTERN,
  AI_DEFAULT_LENGTHS,
  AI_LENGTH_LIMITS,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_REF_PATTERN,
  AI_PROVIDERS,
  AI_STYLE_GROUPS,
} from '../sdk.js';
import type { AiServices } from './services/index.js';

const { pagination, spaceItem, spaceScoped, uuid } = schemas;

const providerKind = z.enum(AI_PROVIDER_KINDS);
/** A hosted provider's kind, or `custom:<slug>` for a self-hosted one. */
const providerRef = z.string().regex(AI_PROVIDER_REF_PATTERN);
const styles = z.record(z.string().max(64), z.string().max(64));
const prompt = z.string().min(1).max(4000);
/** Design descriptions run longer than field prompts. */
const designPrompt = z.string().min(1).max(12_000);

/** Where the dialog was opened from. */
const context = z.object({
  contentTypeLabel: z.string().max(200).nullable().optional(),
  fieldLabel: z.string().max(200).nullable().optional(),
  fieldType: z.string().max(64).nullable().optional(),
  locale: z.string().max(10).nullable().optional(),
  documentTitle: z.string().max(500).nullable().optional(),
  siblings: z.record(z.string().max(100), z.string().max(4000)).nullable().optional(),
  maxLength: z.number().int().positive().nullable().optional(),
});

/** Exact length overriding the preset: words, and blocks per block field. */
const length = z.object({
  words: z.number().int().min(1).max(AI_LENGTH_LIMITS.words).optional(),
  blocks: z.number().int().min(1).max(AI_LENGTH_LIMITS.blocks).optional(),
});

const generateInput = spaceScoped.extend({
  /** Provider ref; defaults to the space's first provider. */
  providerKind: providerRef.optional(),
  /** Overrides the provider's model for this generation. */
  model: z.string().max(200).optional(),
  prompt,
  styles: styles.optional(),
  length: length.optional(),
  context: context.optional(),
});

const designInput = spaceScoped.extend({
  providerKind: providerRef.optional(),
  model: z.string().max(200).optional(),
  prompt: designPrompt,
  /** Icon names the client can draw. */
  icons: z.array(z.string().max(64)).max(300).optional(),
});

const customConfig = z
  .object({
    baseUrl: z.string().url().max(500),
    api: z.enum(AI_CUSTOM_APIS),
    capabilities: z.array(z.enum(['text', 'image'])).max(2),
    json: z.boolean(),
    maxOutputTokens: z.number().int().positive().max(1_000_000).nullable(),
    contextWindow: z.number().int().positive().max(10_000_000).nullable(),
    timeoutSeconds: z.number().int().min(5).max(3600).nullable(),
  })
  .partial();

const lengthPreset = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  fieldWords: z.number().int().min(1).max(AI_LENGTH_LIMITS.words),
  documentWords: z.number().int().min(1).max(AI_LENGTH_LIMITS.words),
  blocks: z.number().int().min(1).max(AI_LENGTH_LIMITS.blocks).nullable(),
});

/**
 * `plugins.ai.*`: settings, generation and design. `ai:configure` sets keys, which are never
 * read back. Designs write nothing; the caller applies the plan via the owning procedure.
 */
export const aiRpc = (kit: PluginRpcKit<AiServices>) => {
  return {
    /** Style pickers and provider metadata. */
    catalog: kit.scoped('ai:read').handler(async ({ context: ctx }) => {
      const api = ctx.manablox.config.server.publicUrl.replace(/\/+$/, '');
      return {
        providers: Object.values(AI_PROVIDERS),
        styleGroups: AI_STYLE_GROUPS,
        lengths: AI_DEFAULT_LENGTHS,
        /** Where an AI agent reads how to drive this instance's API. */
        agentGuide: {
          llms: `${api}/llms.txt`,
          llmsFull: `${api}/llms-full.txt`,
          openapi: `${api}/openapi.json`,
          api: `${api}/api/v1`,
        },
      };
    }),

    providers: kit
      .scoped('ai:read')
      .input(spaceScoped)
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.listProviders(input.spaceId),
      ),

    /** Provider refs per capability in this space; also while AI is locked, for the admin's locks. */
    available: kit
      .scoped('ai:read', { locked: true })
      .input(spaceScoped)
      .handler(async ({ input, context: ctx }) => ctx.plugin.services.ai.available(input.spaceId)),

    saveProvider: kit
      .scoped('ai:configure')
      .input(
        spaceScoped.extend({
          kind: providerKind,
          /** Names a self-hosted provider within the space; ignored for a hosted one. */
          slug: z.string().regex(AI_CUSTOM_SLUG_PATTERN).optional(),
          label: z.string().max(200).optional(),
          enabled: z.boolean().optional(),
          // Absent keeps the stored key, `null` removes it, a string replaces it.
          apiKey: z.string().max(500).nullable().optional(),
          // Partial: only the provider's capabilities.
          models: z
            .object({
              text: z.string().max(200),
              image: z.string().max(200),
              video: z.string().max(200),
            })
            .partial()
            .optional(),
          systemPrompt: z.string().max(8000).optional(),
          defaults: styles.optional(),
          /** A self-hosted provider's endpoint and what it can do. */
          config: customConfig.optional(),
        }),
      )
      .handler(async ({ input, context: ctx }) => {
        const { spaceId, config, ...data } = input;
        return ctx.plugin.services.ai.saveProvider(spaceId, {
          ...data,
          ...(config
            ? {
                config: Object.fromEntries(
                  Object.entries(config).map(([key, value]) => [key, value ?? undefined]),
                ),
              }
            : {}),
        });
      }),

    /** `kind` takes a ref: the hosted kind, or `custom:<slug>`. */
    deleteProvider: kit
      .scoped('ai:configure')
      .input(spaceScoped.extend({ kind: providerRef }))
      .handler(async ({ input, context: ctx }) => {
        await ctx.plugin.services.ai.deleteProvider(input.spaceId, input.kind);
        return { ok: true };
      }),

    /** Tests the provider with the stored key. */
    testProvider: kit
      .scoped('ai:configure')
      .input(spaceScoped.extend({ kind: providerRef }))
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.testProvider(input.spaceId, input.kind),
      ),

    /** Copies every provider, keys included, between spaces. Needs `ai:configure` on both. */
    copyProviders: kit
      .scoped('ai:configure')
      .input(spaceScoped.extend({ fromSpaceId: uuid }))
      .handler(async ({ input, context: ctx }) => {
        assertCan(ctx.principal, input.fromSpaceId, 'ai:configure');
        return ctx.plugin.services.ai.copyProviders(input.fromSpaceId, input.spaceId);
      }),

    /** Length presets for this space. */
    settings: kit
      .scoped('ai:read')
      .input(spaceScoped)
      .handler(async ({ input, context: ctx }) => ctx.plugin.services.ai.settings(input.spaceId)),

    saveSettings: kit
      .scoped('ai:configure')
      .input(
        spaceScoped.extend({
          lengths: z.array(lengthPreset).min(1).max(AI_LENGTH_LIMITS.presets),
        }),
      )
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.saveSettings(input.spaceId, { lengths: input.lengths }),
      ),

    /** Text, answered inside the request. */
    generateText: kit
      .scoped('ai:use')
      .input(generateInput)
      .handler(async ({ input, context: ctx }) => {
        const { text, generation } = await ctx.plugin.services.ai.generateText({
          ...input,
          actorId: ctx.principal.userId,
        });
        return { text, generationId: generation.id };
      }),

    /** Image or video. Returns at once; poll `generation` until it settles. */
    generateMedia: kit
      .scoped('ai:use')
      .input(generateInput.extend({ capability: z.enum(['image', 'video']) }))
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.startMedia({ ...input, actorId: ctx.principal.userId }),
      ),

    /** A whole document's text, blocks, grid and picture briefs in one answer, so the parts agree. */
    generateDocument: kit
      .scoped('ai:use')
      .input(
        generateInput.extend({
          contentTypeId: uuid,
          locale: z.string().max(10).nullable().optional(),
          /** Allowed block type ids; empty allows all. */
          blockTypes: z.array(uuid).max(200).optional(),
          /** False omits pictures. */
          images: z.boolean().optional(),
          audience: z.string().max(500).optional(),
          keywords: z.array(z.string().min(1).max(100)).max(30).optional(),
        }),
      )
      .handler(async ({ input, context: ctx }) => {
        const { fields, blocks, grids, items, images, generation } =
          await ctx.plugin.services.ai.generateDocument({
            ...input,
            actorId: ctx.principal.userId,
          });
        return { fields, blocks, grids, items, images, generationId: generation.id };
      }),

    /**
     * A content type plan for `contentTypes.applyPlan`, referencing by name.
     * `forNewSpace` uses global types only; the space then just supplies the provider.
     */
    designContentTypes: kit
      .scoped('ai:use')
      .input(
        designInput.extend({
          scope: z.enum(['any', 'content', 'block']).default('any'),
          forNewSpace: z.boolean().default(false),
        }),
      )
      .handler(async ({ input, context: ctx }) => {
        if (!input.forNewSpace) assertCan(ctx.principal, input.spaceId, 'contentType:read');
        return ctx.plugin.services.design.designContentTypes({
          ...input,
          typeScope: ctx.env,
          actorId: ctx.principal.userId,
        });
      }),

    /** A template's blocks plus any missing block types. Apply the plan before creating the template. */
    designTemplate: kit
      .scoped('ai:use', { also: ['contentType:read'] })
      .input(designInput.extend({ locale: z.string().max(10).nullable().optional() }))
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.design.designTemplate({
          ...input,
          typeScope: ctx.env,
          actorId: ctx.principal.userId,
        }),
      ),

    generation: kit
      .scoped('ai:read')
      .input(spaceItem)
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.generation(input.spaceId, input.id),
      ),

    /** A page of the space's generations, newest first. */
    generations: kit
      .scoped('ai:read')
      .input(spaceScoped.extend({ pagination: pagination({ limit: 20, max: 100 }) }))
      .handler(async ({ input, context: ctx }) =>
        ctx.plugin.services.ai.pageGenerations(input.spaceId, input.pagination),
      ),
  };
};

/** The router's type, for a typed client: `PluginRouterClient<AiRouter>`. */
export type AiRouter = PluginRouterOf<typeof aiRpc>;
