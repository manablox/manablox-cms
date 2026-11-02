import { type Controls, type FeatureKey, ManabloxError, parseJsonObject } from '@manablox/core';
import type { Logger } from '@manablox/core/node';
import type { MediaService } from '@manablox/media';
import type { AiCapability } from '../../../sdk.js';
import type {
  AiGenerationRow,
  AiGenerationWriteData,
  AiProviderRow,
  AiRepository,
} from '../../db/index.js';
import { aiKeys } from '../../keys.js';
import type { AiRequestContext } from '../../prompt.js';
import { capabilityOf } from '../../providers/index.js';
import { mediaCall, retryPrompt } from './assembly.js';
import { explainBlocked } from './custom-config.js';
import type { AiProviderResolver } from './providers.js';
import type { AiUsage } from './usage.js';

/** The flag each media capability needs next to the plugin's own. */
const MEDIA_FEATURES: Record<'image' | 'video', FeatureKey> = {
  image: aiKeys.features.images,
  video: aiKeys.features.video,
};

/**
 * Throws `control.feature` unless the plugin and the capability's flag are on in the space, and
 * `control.usage` while its AI calls are used up.
 */
export async function assertMediaAllowed(
  controls: Controls,
  spaceId: string,
  capability: 'image' | 'video',
): Promise<void> {
  await controls.assertFeature(spaceId, aiKeys.feature);
  await controls.assertFeature(spaceId, MEDIA_FEATURES[capability]);
  await controls.assertUsage(spaceId, aiKeys.usage.calls);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

/** Records a generation around a provider call: running, then succeeded or failed. */
export class AiGenerationLoop {
  constructor(
    private readonly logger: Logger,
    private readonly store: AiRepository,
    private readonly media: MediaService,
    private readonly providers: AiProviderResolver,
    private readonly usage: AiUsage,
    private readonly controls: () => Controls,
  ) {}

  open(data: AiGenerationWriteData): Promise<AiGenerationRow> {
    return this.store.createGeneration(data);
  }

  /** Runs `work` for a running row; success is stored and audited, failure stored and rethrown. */
  async attempt<T>(
    generation: AiGenerationRow,
    provider: AiProviderRow,
    capability: AiCapability,
    prompt: string,
    work: () => Promise<{ value: T; result: Record<string, unknown> }>,
  ): Promise<{ generation: AiGenerationRow; value: T }> {
    try {
      const { value, result } = await work();
      const row = await this.store.finishGeneration(generation.id, {
        status: 'succeeded',
        result,
      });
      await this.usage.recordUse(
        generation.spaceId,
        this.providers.labelOf(provider),
        capability,
        prompt,
      );
      return { generation: row ?? generation, value };
    } catch (error) {
      await this.fail(generation.id, error);
      throw explainBlocked(error, provider);
    }
  }

  /** Asks again while the checked answer has problems; the last usable answer wins. */
  async refine<T>(
    instruction: string,
    retries: number,
    generate: (prompt: string) => Promise<string>,
    check: (answer: Record<string, unknown>) => Promise<{ value: T; problems: string[] }>,
  ): Promise<{ value: T; problems: string[] }> {
    let prompt = instruction;
    let last: { value: T; problems: string[] } | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const text = await generate(prompt);
      const parsed = parseJsonObject(text);
      const checked = parsed ? await check(parsed) : null;
      // Non-JSON keeps the last usable answer.
      if (checked) last = checked;
      if (checked && !checked.problems.length) break;

      if (attempt < retries) {
        const problems = checked?.problems ?? ['The answer was not a JSON object.'];
        prompt = retryPrompt(instruction, text, problems);
      }
    }

    if (!last) throw ManabloxError.badRequest('plugins.ai.response.unusable');
    return last;
  }

  /** Runs a pending media generation and stores the result as an asset. Failures go on the row. */
  async runMedia(generationId: string): Promise<void> {
    const generation = await this.store.findGenerationById(generationId);
    if (!generation)
      throw ManabloxError.notFound('plugins.ai.generation.notFound', { id: generationId });
    if (generation.status !== 'pending') return;

    await this.store.markRunning(generation.id);

    try {
      const provider = generation.providerId
        ? await this.store.findProviderById(generation.providerId)
        : null;
      if (!provider) {
        throw ManabloxError.notFound('plugins.ai.provider.notFound', {
          kind: generation.providerKind,
        });
      }
      const capability = generation.kind === 'video' ? 'video' : 'image';
      // A job queued before the feature went off fails.
      await assertMediaAllowed(this.controls(), generation.spaceId, capability);
      const generateMedia = capabilityOf(provider.kind, capability);

      const options = generation.options as {
        styles?: Record<string, string>;
        context?: AiRequestContext;
      };
      const result = await generateMedia({
        ...this.providers.callBase(provider, generation.model),
        ...mediaCall(capability, generation.prompt, options.styles ?? {}, options.context ?? {}),
      });

      const asset = await this.media.upload({
        spaceId: generation.spaceId,
        filename: `${result.filename}${EXTENSIONS[result.mimeType] ?? ''}`,
        mimeType: result.mimeType,
        body: result.body,
        alt: generation.prompt.slice(0, 300),
        actorId: generation.actorId,
      });

      await this.store.finishGeneration(generation.id, {
        status: 'succeeded',
        assetId: asset.id,
        result: { assetId: asset.id },
      });
      await this.usage.recordUse(
        generation.spaceId,
        this.providers.labelOf(provider),
        capability,
        generation.prompt,
      );
    } catch (error) {
      await this.fail(generation.id, error);
    }
  }

  /** Stores the failure key and params on the row; a job has no caller to report to. */
  async fail(generationId: string, error: unknown): Promise<void> {
    this.logger.warn({ err: error, generationId }, 'ai generation failed');

    if (ManabloxError.is(error)) {
      await this.store.finishGeneration(generationId, {
        status: 'failed',
        error: error.key,
        errorDetail: error.details[0]?.params ?? null,
      });
      return;
    }

    // Non-Manablox errors only have a message.
    const message = error instanceof Error ? error.message : String(error);
    await this.store.finishGeneration(generationId, {
      status: 'failed',
      error: 'plugins.ai.generation.failed',
      errorDetail: { message },
    });
  }
}
