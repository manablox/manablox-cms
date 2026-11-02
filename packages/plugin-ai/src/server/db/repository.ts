import {
  type AgeCutoff,
  type DatabaseContext,
  firstPage,
  type Paginated,
  type Pagination,
  Repository,
} from '@manablox/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  AiCustomConfig,
  AiGenerationKind,
  AiGenerationStatus,
  AiModelMap,
  AiProviderKind,
} from '../../sdk.js';
import { type AiGenerationRow, type AiProviderRow, type AiTables, aiTables } from './rows.js';

export interface AiProviderWriteData {
  /** Lets an import keep the exported id. */
  id?: string | undefined;
  spaceId: string;
  kind: AiProviderKind;
  /** Names a self-hosted provider; empty for hosted ones. */
  slug?: string | undefined;
  label?: string | undefined;
  enabled?: boolean | undefined;
  /** Already encrypted; `undefined` keeps the stored key, `null` clears it. */
  apiKey?: string | null | undefined;
  apiKeyHint?: string | null | undefined;
  models?: AiModelMap | undefined;
  systemPrompt?: string | undefined;
  defaults?: Record<string, string> | undefined;
  config?: Partial<AiCustomConfig> | undefined;
}

export interface AiGenerationWriteData {
  spaceId: string;
  providerId: string | null;
  providerKind: AiProviderKind;
  kind: AiGenerationKind;
  status?: AiGenerationStatus | undefined;
  model: string;
  prompt: string;
  options?: Record<string, unknown> | undefined;
  actorId?: string | null | undefined;
}

export interface AiGenerationFinishData {
  status: AiGenerationStatus;
  result?: Record<string, unknown> | null | undefined;
  assetId?: string | null | undefined;
  error?: string | null | undefined;
  errorDetail?: Record<string, unknown> | null | undefined;
}

/** A space's AI providers and generation log. */
export class AiRepository extends Repository<AiTables> {
  constructor(context: DatabaseContext) {
    super(context, aiTables(context));
  }

  countProvidersBySpace(spaceId: string): Promise<number> {
    const { aiProviders } = this.t;
    return this.db.$count(aiProviders, eq(aiProviders.spaceId, spaceId));
  }

  listProvidersBySpace(spaceId: string): Promise<AiProviderRow[]> {
    const { aiProviders } = this.t;
    return this.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.spaceId, spaceId))
      .orderBy(aiProviders.kind, aiProviders.slug);
  }

  /** A hosted provider by its kind, or a self-hosted one by kind and slug. */
  findProviderByKind(
    spaceId: string,
    kind: AiProviderKind,
    slug = '',
  ): Promise<AiProviderRow | null> {
    const { aiProviders } = this.t;
    return this.findOneWhere(
      aiProviders,
      and(eq(aiProviders.spaceId, spaceId), eq(aiProviders.kind, kind), eq(aiProviders.slug, slug)),
    );
  }

  findProviderById(id: string): Promise<AiProviderRow | null> {
    return this.findOne(this.t.aiProviders, id);
  }

  /** Upserts on space, kind and slug. */
  async upsertProvider(data: AiProviderWriteData): Promise<AiProviderRow> {
    const { aiProviders } = this.t;
    const slug = data.slug ?? '';
    const existing = await this.findProviderByKind(data.spaceId, data.kind, slug);
    const patch = {
      ...(data.label === undefined ? {} : { label: data.label }),
      ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
      ...(data.apiKey === undefined ? {} : { apiKey: data.apiKey }),
      ...(data.apiKeyHint === undefined ? {} : { apiKeyHint: data.apiKeyHint }),
      ...(data.models === undefined ? {} : { models: data.models }),
      ...(data.systemPrompt === undefined ? {} : { systemPrompt: data.systemPrompt }),
      ...(data.defaults === undefined ? {} : { defaults: data.defaults }),
      ...(data.config === undefined ? {} : { config: data.config }),
    };

    if (existing) {
      const rows = await this.db
        .update(aiProviders)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(aiProviders.id, existing.id))
        .returning();
      return rows[0] as AiProviderRow;
    }

    const rows = await this.db
      .insert(aiProviders)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        kind: data.kind,
        slug,
        ...patch,
      })
      .returning();
    return rows[0] as AiProviderRow;
  }

  deleteProvider(id: string): Promise<boolean> {
    return this.removeOne(this.t.aiProviders, id);
  }

  async createGeneration(data: AiGenerationWriteData): Promise<AiGenerationRow> {
    const { aiGenerations } = this.t;
    const rows = await this.db
      .insert(aiGenerations)
      .values({
        spaceId: data.spaceId,
        providerId: data.providerId,
        providerKind: data.providerKind,
        kind: data.kind,
        status: data.status ?? 'pending',
        model: data.model,
        prompt: data.prompt,
        options: data.options ?? {},
        actorId: data.actorId ?? null,
      })
      .returning();
    return rows[0] as AiGenerationRow;
  }

  findGenerationById(id: string): Promise<AiGenerationRow | null> {
    return this.findOne(this.t.aiGenerations, id);
  }

  async markRunning(id: string): Promise<void> {
    const { aiGenerations } = this.t;
    await this.db.update(aiGenerations).set({ status: 'running' }).where(eq(aiGenerations.id, id));
  }

  async finishGeneration(
    id: string,
    data: AiGenerationFinishData,
  ): Promise<AiGenerationRow | null> {
    const { aiGenerations } = this.t;
    const rows = await this.db
      .update(aiGenerations)
      .set({
        status: data.status,
        result: data.result ?? null,
        assetId: data.assetId ?? null,
        error: data.error ?? null,
        errorDetail: data.errorDetail ?? null,
        finishedAt: new Date(),
      })
      .where(eq(aiGenerations.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Deletes a batch of the space's finished generations older than the cutoff. */
  pruneGenerations(age: AgeCutoff): Promise<number> {
    const { aiGenerations } = this.t;
    return this.pruneAged(
      aiGenerations,
      age,
      inArray(aiGenerations.status, ['succeeded', 'failed']),
    );
  }

  /** A page of the space's generations, newest first. */
  pageGenerationsBySpace(
    spaceId: string,
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<AiGenerationRow>> {
    const { aiGenerations } = this.t;
    return this.paginate(
      aiGenerations,
      eq(aiGenerations.spaceId, spaceId),
      [desc(aiGenerations.createdAt), desc(aiGenerations.id)],
      pagination,
    );
  }
}
