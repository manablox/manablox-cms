import { ManabloxError, type Scope, scopeSpaceId } from '@manablox/core';
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { batches } from '../batch.js';
import { escapeLike } from '../dialect.js';
import { TAG_LIST_LIMIT } from '../pagination.js';
import type { TagRow } from '../schema/index.js';
import { inProduction, Repository } from './base.js';

/** A tag with how many documents and assets carry it. */
export interface TagWithCounts extends TagRow {
  contentCount: number;
  assetCount: number;
}

/** Parameters an inserted tag row can bind: every column. */
const TAG_COLUMNS = 7;

export interface TagInput {
  name: string;
  slug: string;
}

export class TagRepository extends Repository {
  /** A space's vocabulary, alphabetical; `search` matches the name. */
  async listBySpace(spaceId: string, search?: string, limit = TAG_LIST_LIMIT): Promise<TagRow[]> {
    const { tags } = this.t;
    const conditions = [eq(tags.spaceId, spaceId)];
    if (search) conditions.push(this.dialect.ilike(tags.name, `%${escapeLike(search)}%`));
    return this.db
      .select()
      .from(tags)
      .where(and(...conditions))
      .orderBy(asc(tags.name))
      .limit(limit);
  }

  /** The vocabulary with usage counts (production documents), for the management screen. */
  async listBySpaceWithCounts(spaceId: string, search?: string): Promise<TagWithCounts[]> {
    const { assetTags, contentTags } = this.t;
    const rows = await this.listBySpace(spaceId, search);
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [contentCounts, assetCounts] = await Promise.all([
      this.db
        .select({ tagId: contentTags.tagId, total: count() })
        .from(contentTags)
        .where(and(inArray(contentTags.tagId, ids), inProduction(this.t, contentTags)))
        .groupBy(contentTags.tagId),
      this.db
        .select({ tagId: assetTags.tagId, total: count() })
        .from(assetTags)
        .where(inArray(assetTags.tagId, ids))
        .groupBy(assetTags.tagId),
    ]);

    const byContent = new Map(contentCounts.map((row) => [row.tagId, Number(row.total)]));
    const byAsset = new Map(assetCounts.map((row) => [row.tagId, Number(row.total)]));
    return rows.map((row) => ({
      ...row,
      contentCount: byContent.get(row.id) ?? 0,
      assetCount: byAsset.get(row.id) ?? 0,
    }));
  }

  findById(id: string, spaceId: string): Promise<TagRow | null> {
    const { tags } = this.t;
    return this.findOneWhere(tags, and(eq(tags.id, id), eq(tags.spaceId, spaceId)));
  }

  /** Only the ids that exist in `spaceId`; an unknown id is dropped. */
  async listByIds(ids: string[], spaceId: string): Promise<TagRow[]> {
    const { tags } = this.t;
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tags)
      .where(and(inArray(tags.id, ids), eq(tags.spaceId, spaceId)));
  }

  async listBySlugs(spaceId: string, slugs: string[]): Promise<TagRow[]> {
    const { tags } = this.t;
    const out: TagRow[] = [];
    for (const batch of batches(slugs, 1, this.dialect.maxParameters)) {
      const rows = await this.db
        .select()
        .from(tags)
        .where(and(eq(tags.spaceId, spaceId), inArray(tags.slug, batch)));
      out.push(...rows);
    }
    return out;
  }

  /** Inserts the tags a space does not have yet and returns every requested tag. */
  async ensure(
    spaceId: string,
    inputs: TagInput[],
    actorId: string | null = null,
  ): Promise<TagRow[]> {
    const { tags } = this.t;
    if (inputs.length === 0) return [];
    const wanted = new Map(inputs.map((input) => [input.slug, input]));
    const rows = [...wanted.values()].map((input) => ({
      spaceId,
      name: input.name,
      slug: input.slug,
      createdBy: actorId,
    }));
    for (const batch of batches(rows, TAG_COLUMNS, this.dialect.maxParameters)) {
      await this.db.insert(tags).values(batch).onConflictDoNothing();
    }
    return this.listBySlugs(spaceId, [...wanted.keys()]);
  }

  async update(id: string, spaceId: string, data: { name: string; slug: string }): Promise<TagRow> {
    const { tags } = this.t;
    const [row] = await this.db
      .update(tags)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tags.id, id), eq(tags.spaceId, spaceId)))
      .returning();
    if (!row) throw ManabloxError.notFound('tag.notFound', { id });
    return row;
  }

  delete(id: string, spaceId: string): Promise<boolean> {
    const { tags } = this.t;
    return this.removeWhere(tags, and(eq(tags.id, id), eq(tags.spaceId, spaceId)));
  }

  /** Moves every assignment of `sourceId` onto `targetId` and drops the source. */
  async merge(sourceId: string, targetId: string, spaceId: string): Promise<void> {
    const { assetTags, contentTags, tags } = this.t;
    await this.db.transaction(async (tx) => {
      const documents = await tx.select().from(contentTags).where(eq(contentTags.tagId, sourceId));
      const assets = await tx.select().from(assetTags).where(eq(assetTags.tagId, sourceId));
      await tx.delete(contentTags).where(eq(contentTags.tagId, sourceId));
      await tx.delete(assetTags).where(eq(assetTags.tagId, sourceId));

      if (documents.length > 0) {
        // A document carrying both tags already has the target row.
        await tx
          .insert(contentTags)
          .values(
            documents.map((row) => ({
              tagId: targetId,
              localizationId: row.localizationId,
              spaceId: row.spaceId,
              environmentId: row.environmentId,
            })),
          )
          .onConflictDoNothing();
      }
      if (assets.length > 0) {
        await tx
          .insert(assetTags)
          .values(assets.map((row) => ({ tagId: targetId, assetId: row.assetId })))
          .onConflictDoNothing();
      }
      await tx.delete(tags).where(and(eq(tags.id, sourceId), eq(tags.spaceId, spaceId)));
    });
  }

  // ---------------------------------------------------------------------------
  // Assignments
  // ---------------------------------------------------------------------------

  /** Tags per localization group, alphabetical; a group without tags is absent. */
  async listByLocalizations(localizationIds: string[]): Promise<Map<string, TagRow[]>> {
    const { contentTags, tags } = this.t;
    const out = new Map<string, TagRow[]>();
    if (localizationIds.length === 0) return out;
    const rows = await this.db
      .select({ localizationId: contentTags.localizationId, tag: tags })
      .from(contentTags)
      .innerJoin(tags, eq(tags.id, contentTags.tagId))
      .where(inArray(contentTags.localizationId, localizationIds))
      .orderBy(asc(tags.name));
    for (const row of rows) {
      const list = out.get(row.localizationId);
      if (list) list.push(row.tag);
      else out.set(row.localizationId, [row.tag]);
    }
    return out;
  }

  /** Tags per asset, alphabetical; `spaceId` narrows them to one space's vocabulary. */
  async listByAssets(assetIds: string[], spaceId?: string | null): Promise<Map<string, TagRow[]>> {
    const { assetTags, tags } = this.t;
    const out = new Map<string, TagRow[]>();
    if (assetIds.length === 0) return out;
    const where = spaceId
      ? and(inArray(assetTags.assetId, assetIds), eq(tags.spaceId, spaceId))
      : inArray(assetTags.assetId, assetIds);
    const rows = await this.db
      .select({ assetId: assetTags.assetId, tag: tags })
      .from(assetTags)
      .innerJoin(tags, eq(tags.id, assetTags.tagId))
      .where(where)
      .orderBy(asc(tags.name));
    for (const row of rows) {
      const list = out.get(row.assetId);
      if (list) list.push(row.tag);
      else out.set(row.assetId, [row.tag]);
    }
    return out;
  }

  /**
   * Replaces a document's tags; `tagIds` must already be verified to be in the space. The
   * assignment takes the document's environment.
   */
  async setForLocalization(scope: Scope, localizationId: string, tagIds: string[]): Promise<void> {
    const { contentTags } = this.t;
    const spaceId = scopeSpaceId(scope);
    const environmentId = this.environmentOfGroup(scope, localizationId);
    await this.db.transaction(async (tx) => {
      await tx.delete(contentTags).where(eq(contentTags.localizationId, localizationId));
      if (tagIds.length === 0) return;
      await tx
        .insert(contentTags)
        .values(tagIds.map((tagId) => ({ tagId, localizationId, spaceId, environmentId })))
        .onConflictDoNothing();
    });
  }

  /** Replaces an asset's tags within one space, leaving other spaces' tags in place. */
  async setForAsset(assetId: string, spaceId: string, tagIds: string[]): Promise<void> {
    const { assetTags, tags } = this.t;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetTags)
        .where(
          and(
            eq(assetTags.assetId, assetId),
            sql`exists (select 1 from ${tags} where ${tags.id} = ${assetTags.tagId} and ${tags.spaceId} = ${spaceId})`,
          ),
        );
      if (tagIds.length === 0) return;
      await tx
        .insert(assetTags)
        .values(tagIds.map((tagId) => ({ tagId, assetId })))
        .onConflictDoNothing();
    });
  }

  /** Adds document assignments in bulk, keeping existing ones; tags must be in each row's space. */
  async seedForLocalizations(
    rows: Array<{
      tagId: string;
      localizationId: string;
      spaceId: string;
      environmentId?: string | undefined;
    }>,
  ): Promise<void> {
    const { contentTags } = this.t;
    for (const batch of batches(rows, 6, this.dialect.maxParameters)) {
      await this.db
        .insert(contentTags)
        .values(
          batch.map((row) => ({
            ...row,
            environmentId: this.environmentOfGroup(row, row.localizationId),
          })),
        )
        .onConflictDoNothing();
    }
  }

  /** The environment of a localization group's documents, else the scope's. */
  private environmentOfGroup(
    scope: Scope | { spaceId: string; environmentId?: string | undefined },
    localizationId: string,
  ): string | SQL {
    if (typeof scope !== 'string' && scope.environmentId) return scope.environmentId;
    const { contents } = this.t;
    const spaceId = scopeSpaceId(typeof scope === 'string' ? scope : scope.spaceId);
    return sql`coalesce((select ${contents.environmentId} from ${contents} where ${contents.localizationId} = ${localizationId} limit 1), ${this.environmentOf(spaceId)})`;
  }

  /** Adds asset assignments in bulk, keeping existing ones. */
  async seedForAssets(rows: Array<{ tagId: string; assetId: string }>): Promise<void> {
    const { assetTags } = this.t;
    for (const batch of batches(rows, 3, this.dialect.maxParameters)) {
      await this.db.insert(assetTags).values(batch).onConflictDoNothing();
    }
  }

  /** Drops the tags of localization groups whose last translation is gone. */
  async deleteByLocalizations(localizationIds: readonly string[]): Promise<boolean> {
    const { contentTags } = this.t;
    let removed = false;
    for (const batch of batches([...localizationIds], 1, this.dialect.maxParameters)) {
      if (await this.removeWhere(contentTags, inArray(contentTags.localizationId, batch))) {
        removed = true;
      }
    }
    return removed;
  }
}
