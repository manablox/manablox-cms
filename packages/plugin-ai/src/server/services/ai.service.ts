import { ManabloxError, parseJsonObject } from '@manablox/core';
import { currentActor, type Manablox } from '@manablox/core/node';
import type { Paginated, Pagination, Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import {
  AI_CUSTOM_SLUG_PATTERN,
  AI_PROVIDERS,
  type AiCapability,
  type AiGenerationKind,
  type AiLengthTarget,
  type AiProviderRef,
  resolveLength,
} from '../../sdk.js';
import { providerAuditor, settingsAuditor } from '../audit.js';
import { type AiGenerationRow, type AiRepository, aiRepos } from '../db/index.js';
import { aiKeys } from '../keys.js';
import { composeTextPrompt } from '../prompt.js';
import { capabilityOf, providerClient } from '../providers/index.js';
import {
  designLabel,
  documentPrompt,
  planDocument,
  readDocumentAnswer,
  requirePrompt,
} from './ai/assembly.js';
import { capabilitiesOf, explainBlocked, normaliseCustomConfig } from './ai/custom-config.js';
import { AiGenerationLoop, assertMediaAllowed } from './ai/generation.js';
import { AiProviderResolver } from './ai/providers.js';
import { normaliseLengths, readSettings, withLengths } from './ai/settings.js';
import type {
  AiDesignJsonInput,
  AiDocumentInput,
  AiDocumentResult,
  AiGenerateInput,
  AiProviderSaveInput,
  AiProviderView,
  AiServiceOptions,
  AiSpaceSettings,
  AiTextResult,
} from './ai/types.js';
import { AiUsage, sizedFor } from './ai/usage.js';

export { capabilitiesOf, normaliseCustomConfig } from './ai/custom-config.js';
export { normaliseLengths, readSettings } from './ai/settings.js';
export type * from './ai/types.js';

/** What `runTextGeneration` records and which provider it picks. */
interface TextRun {
  spaceId: string;
  providerKind?: AiProviderRef | undefined;
  model?: string | undefined;
  actorId?: string | null | undefined;
  /** Stored on the row. */
  prompt: string;
  /** Audited prompt; defaults to `prompt`. */
  usage?: string | undefined;
  /** Length preset scope; absent skips the settings load. */
  length?:
    | {
        scope: 'field' | 'document';
        styles: Record<string, string> | undefined;
        target: AiLengthTarget | undefined;
      }
    | undefined;
}

/** One text request inside a run; unset fields come from the provider and length. */
interface TextCall {
  prompt: string;
  system?: string | undefined;
  json?: boolean | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
}

/** AI providers and generation. Text runs in the request; image and video run as polled jobs. */
export class AiService {
  private readonly providers: AiProviderResolver;
  private readonly loop: AiGenerationLoop;
  private readonly providerAudit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    media: MediaService,
    private readonly options: AiServiceOptions,
    /** The providers and generations; the plugin's repository on `repos` by default. */
    private readonly store: AiRepository = aiRepos(repos),
  ) {
    this.providers = new AiProviderResolver(store, {
      secret: options.secret,
      fetch: options.fetch,
    });
    this.providerAudit = providerAuditor(repos, (row) => this.providers.labelOf(row));
    this.loop = new AiGenerationLoop(
      manablox.logger,
      store,
      media,
      this.providers,
      new AiUsage(repos, () => manablox.controls),
      () => manablox.controls,
    );
  }

  // Providers

  async listProviders(spaceId: string): Promise<AiProviderView[]> {
    const rows = await this.providers.list(spaceId);
    return rows.map((row) => this.providers.present(row));
  }

  /** Upserts the space's provider by kind (and slug for a self-hosted one). */
  async saveProvider(spaceId: string, input: AiProviderSaveInput): Promise<AiProviderView> {
    const meta = AI_PROVIDERS[input.kind];
    if (!meta)
      throw ManabloxError.badRequest('plugins.ai.provider.kind.unknown', { kind: input.kind });

    const custom = input.kind === 'custom';
    const slug = custom ? (input.slug ?? '').trim() : '';
    if (custom && !AI_CUSTOM_SLUG_PATTERN.test(slug)) {
      throw ManabloxError.badRequest('plugins.ai.provider.custom.slugInvalid', { slug });
    }

    const before = await this.store.findProviderByKind(spaceId, input.kind, slug);
    const key = this.providers.encodeKey(input.apiKey);
    const config = custom
      ? normaliseCustomConfig({ ...(before?.config ?? {}), ...(input.config ?? {}) })
      : undefined;

    const row = await this.store.upsertProvider({
      spaceId,
      kind: input.kind,
      slug,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.models === undefined ? {} : { models: input.models }),
      ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
      ...(input.defaults === undefined ? {} : { defaults: input.defaults }),
      ...(config ? { config } : {}),
      ...key,
    });

    // Log only whether a key is set, never the key.
    await this.providerAudit.record('ai.provider.configure', row, [
      { path: 'enabled', from: before?.enabled ?? false, to: row.enabled },
      { path: 'apiKey', from: Boolean(before?.apiKey), to: Boolean(row.apiKey) },
      { path: 'models', from: before?.models ?? {}, to: row.models },
      { path: 'systemPrompt', from: before?.systemPrompt ?? '', to: row.systemPrompt },
      ...(custom ? [{ path: 'config', from: before?.config ?? {}, to: row.config }] : []),
    ]);

    return this.providers.present(row);
  }

  async deleteProvider(spaceId: string, ref: AiProviderRef): Promise<void> {
    const row = await this.providers.require(spaceId, ref);
    await this.store.deleteProvider(row.id);
    await this.providerAudit.record('ai.provider.delete', row, []);
  }

  /** Verifies the stored key against every capability the provider serves. */
  async testProvider(spaceId: string, ref: AiProviderRef): Promise<{ ok: true }> {
    const row = await this.providers.require(spaceId, ref);
    const client = providerClient(row.kind);
    try {
      for (const capability of capabilitiesOf(row)) {
        await client.verify(this.providers.callBase(row, this.providers.modelFor(row, capability)));
      }
    } catch (error) {
      throw explainBlocked(error, row);
    }
    return { ok: true };
  }

  /** Copies a space's providers, keys re-encrypted, into another space. Caller checks access. */
  async copyProviders(fromSpaceId: string, toSpaceId: string): Promise<AiProviderView[]> {
    const rows = await this.providers.list(fromSpaceId);
    const copied: AiProviderView[] = [];
    for (const row of rows) {
      copied.push(
        await this.saveProvider(toSpaceId, {
          kind: row.kind,
          slug: row.slug,
          label: row.label,
          enabled: row.enabled,
          apiKey: this.providers.storedKey(row),
          models: row.models,
          systemPrompt: row.systemPrompt,
          defaults: row.defaults,
          ...(row.kind === 'custom' ? { config: row.config } : {}),
        }),
      );
    }
    return copied;
  }

  // Settings

  /** The space's length presets, or the defaults. */
  async settings(spaceId: string): Promise<AiSpaceSettings> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { id: spaceId });
    return readSettings(space.settings);
  }

  async saveSettings(spaceId: string, input: AiSpaceSettings): Promise<AiSpaceSettings> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { id: spaceId });

    const lengths = normaliseLengths(input.lengths);
    const before = readSettings(space.settings);
    await this.repos.spaces.update(spaceId, { settings: withLengths(space.settings, lengths) });
    await settingsAuditor(this.repos).record('ai.settings.update', space, [
      { path: 'lengths', from: before.lengths, to: lengths },
    ]);
    return { lengths };
  }

  // Generation

  /** Generates text inside the request and records the generation. */
  async generateText(input: AiGenerateInput): Promise<AiTextResult> {
    const prompt = requirePrompt(input.prompt);
    const { generation, value: text } = await this.runTextGeneration(
      'text',
      { ...input, prompt, length: { scope: 'field', styles: input.styles, target: input.length } },
      (length) => ({
        styles: input.styles ?? {},
        context: input.context ?? {},
        ...(length ? { length } : {}),
      }),
      async (generate, length) => {
        const text = await generate({
          prompt: composeTextPrompt(prompt, input.styles, input.context ?? {}, length),
        });
        return { value: text, result: { text } };
      },
    );
    return { generation, text };
  }

  /** Starts an image or video job; returns the pending row to poll. */
  async startMedia(
    input: AiGenerateInput & { capability: Extract<AiCapability, 'image' | 'video'> },
  ): Promise<AiGenerationRow> {
    await assertMediaAllowed(this.manablox.controls, input.spaceId, input.capability);
    await this.assertCallRate(input.spaceId, input.actorId);
    const prompt = requirePrompt(input.prompt);
    const provider = await this.providers.pick(input.spaceId, input.capability, input.providerKind);
    // Fail before recording if the provider cannot do the job.
    capabilityOf(provider.kind, input.capability);

    const generation = await this.loop.open({
      spaceId: input.spaceId,
      providerId: provider.id,
      providerKind: provider.kind,
      kind: input.capability,
      status: 'pending',
      model: this.providers.resolveModel(provider, input.capability, input.model),
      prompt,
      options: { styles: input.styles ?? {}, context: input.context ?? {} },
      actorId: input.actorId ?? null,
    });

    if (this.options.enqueue) await this.options.enqueue(generation.id, generation.spaceId);
    else await this.runGeneration(generation.id);

    return (await this.store.findGenerationById(generation.id)) ?? generation;
  }

  /** Runs a pending media generation and stores the result as an asset. Failures go on the row. */
  runGeneration(generationId: string): Promise<void> {
    return this.loop.runMedia(generationId);
  }

  /** Writes all writable text fields of a content type as one document. */
  async generateDocument(input: AiDocumentInput): Promise<AiDocumentResult> {
    const prompt = requirePrompt(input.prompt);
    const type = this.manablox.contentTypes.tryGet(input.contentTypeId);
    if (!type) {
      throw ManabloxError.notFound('plugins.ai.document.type.notFound', {
        id: input.contentTypeId,
      });
    }
    const plan = planDocument(type, this.manablox.contentTypes, input);

    const { generation, value } = await this.runTextGeneration(
      'document',
      {
        ...input,
        prompt,
        length: { scope: 'document', styles: input.styles, target: input.length },
      },
      (length) => ({
        styles: input.styles ?? {},
        contentTypeId: type.id,
        locale: input.locale ?? null,
        ...(length ? { length } : {}),
        ...(input.blockTypes?.length ? { blockTypes: input.blockTypes } : {}),
        images: input.images !== false,
      }),
      async (generate, length) => {
        const text = await generate({
          json: true,
          prompt: documentPrompt(plan, prompt, input, length),
        });
        const parsed = parseJsonObject(text);
        if (!parsed) throw ManabloxError.badRequest('plugins.ai.response.unusable');
        const answer = readDocumentAnswer(parsed, plan);
        return { value: answer, result: { ...answer } };
      },
    );
    return { generation, ...value };
  }

  /** A structured design from one instruction; answers with problems are sent back to fix. */
  async designJson<T>(
    input: AiDesignJsonInput<T>,
  ): Promise<{ value: T; problems: string[]; generationId: string }> {
    const instruction = requirePrompt(input.prompt);
    const retries = Math.max(0, this.options.designRetries ?? 2);
    const { generation, value } = await this.runTextGeneration(
      'design',
      // Record the request, not the catalogue it was sent with.
      { ...input, prompt: designLabel(input.purpose, instruction), usage: input.purpose },
      () => ({ purpose: input.purpose }),
      async (generate) => {
        const last = await this.loop.refine(
          instruction,
          retries,
          (prompt) =>
            generate({
              system: input.system,
              json: true,
              maxTokens: input.maxTokens ?? 24_000,
              timeoutMs: 300_000,
              prompt,
            }),
          input.check,
        );
        return { value: last, result: { purpose: input.purpose, problems: last.problems } };
      },
    );
    return { ...value, generationId: generation.id };
  }

  /** `plugins.ai.calls` per user; a workflow or the system counts as one caller. */
  private async assertCallRate(spaceId: string, actorId: string | null | undefined): Promise<void> {
    const actor = currentActor();
    const caller = actorId ?? actor.id ?? actor.kind;
    await this.manablox.controls.assertRate(spaceId, [{ rule: aiKeys.usage.calls, key: caller }]);
  }

  /** Picks a text provider, opens a running row and records the outcome of `work`. */
  private async runTextGeneration<T>(
    kind: Extract<AiGenerationKind, 'text' | 'document' | 'design'>,
    input: TextRun,
    options: (length: AiLengthTarget | null) => Record<string, unknown>,
    work: (
      generate: (call: TextCall) => Promise<string>,
      length: AiLengthTarget | null,
    ) => Promise<{ value: T; result: Record<string, unknown> }>,
  ): Promise<{ generation: AiGenerationRow; value: T }> {
    await this.manablox.controls.assertFeature(input.spaceId, aiKeys.feature);
    await this.manablox.controls.assertUsage(input.spaceId, aiKeys.usage.calls);
    await this.assertCallRate(input.spaceId, input.actorId);
    const [provider, settings] = await Promise.all([
      this.providers.pick(input.spaceId, 'text', input.providerKind),
      input.length ? this.settings(input.spaceId) : null,
    ]);
    const generateText = capabilityOf(provider.kind, 'text');
    const length =
      input.length && settings
        ? resolveLength(
            input.length.scope,
            input.length.styles,
            settings.lengths,
            input.length.target,
          )
        : null;
    const model = this.providers.resolveModel(provider, 'text', input.model);

    const generation = await this.loop.open({
      spaceId: input.spaceId,
      providerId: provider.id,
      providerKind: provider.kind,
      kind,
      status: 'running',
      model,
      prompt: input.prompt,
      options: options(length),
      actorId: input.actorId ?? null,
    });

    return this.loop.attempt(generation, provider, 'text', input.usage ?? input.prompt, () =>
      work(async ({ system, ...call }) => {
        const { text } = await generateText({
          ...this.providers.callBase(provider, model, system),
          ...sizedFor(length?.words),
          options: {},
          ...call,
        });
        return text;
      }, length),
    );
  }

  async generation(spaceId: string, id: string): Promise<AiGenerationRow> {
    const row = await this.store.findGenerationById(id);
    if (!row || row.spaceId !== spaceId) {
      throw ManabloxError.notFound('plugins.ai.generation.notFound', { id });
    }
    return row;
  }

  /** A page of the space's generations, newest first. */
  pageGenerations(spaceId: string, pagination?: Pagination): Promise<Paginated<AiGenerationRow>> {
    return this.store.pageGenerationsBySpace(spaceId, pagination);
  }

  /** Usable provider refs per capability. */
  available(spaceId: string): Promise<Record<AiCapability, AiProviderRef[]>> {
    return this.providers.available(spaceId);
  }
}
