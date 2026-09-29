import { and, count, eq, exists, inArray, notInArray, type SQL, sql } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { Tables } from '../tables.js';
import { inProduction, Repository } from './base.js';

/** Which documents reference which assets; `published` tracks the projection, not the draft. */
export class AssetUsageRepository extends Repository {
  /**
   * The subset of `assetIds` reachable from at least one published document of a production
   * environment or, when given, of the staging environment `stagingId`.
   */
  async filterPublished(assetIds: string[], stagingId?: string | null): Promise<Set<string>> {
    const { assets, assetUsages } = this.t;
    if (assetIds.length === 0) return new Set();
    // A semi-join stops at the first published usage instead of reading them all.
    const rows = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          inArray(assets.id, assetIds),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(assetUsages)
              .where(
                and(
                  eq(assetUsages.assetId, assets.id),
                  eq(assetUsages.published, true),
                  publishedIn(this.t, stagingId),
                ),
              ),
          ),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  async listByContent(contentId: string): Promise<Array<{ assetId: string; published: boolean }>> {
    const { assetUsages } = this.t;
    return this.db
      .select({ assetId: assetUsages.assetId, published: assetUsages.published })
      .from(assetUsages)
      .where(eq(assetUsages.contentId, contentId));
  }

  /** Bulk-inserts usages for an import into an empty space, without reconciling. */
  async seed(
    rows: Array<{ assetId: string; contentId: string; spaceId: string; published: boolean }>,
  ): Promise<void> {
    const { assetUsages } = this.t;
    if (rows.length === 0) return;
    const now = new Date();
    // Deduplicated first: ON CONFLICT DO UPDATE refuses a pair twice in one statement.
    const unique = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.assetId}:${row.contentId}`;
      const seen = unique.get(key);
      // Published wins, as in the conflict clause.
      if (!seen) unique.set(key, row);
      else if (row.published && !seen.published) unique.set(key, row);
    }
    // Sliced for the database's parameter ceiling.
    for (const batch of batches([...unique.values()], 6, this.dialect.maxParameters)) {
      await this.db
        .insert(assetUsages)
        .values(
          batch.map((row) => ({
            ...row,
            environmentId: this.environmentOfContent(row.contentId),
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [assetUsages.assetId, assetUsages.contentId],
          set: { published: sql`${assetUsages.published} or excluded.published` },
        });
    }
  }

  /** Records what a draft references; published rows survive, so the live page keeps its images. */
  async recordDraft(contentId: string, spaceId: string, assetIds: string[]): Promise<void> {
    const { assetUsages } = this.t;
    const unique = [...new Set(assetIds)];

    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetUsages)
        .where(
          and(
            eq(assetUsages.contentId, contentId),
            eq(assetUsages.published, false),
            ...(unique.length > 0 ? [notInArray(assetUsages.assetId, unique)] : []),
          ),
        );

      if (unique.length === 0) return;

      await tx
        .insert(assetUsages)
        .values(
          unique.map((assetId) => ({
            assetId,
            contentId,
            spaceId,
            environmentId: this.environmentOfContent(contentId),
            published: false,
            updatedAt: new Date(),
          })),
        )
        // Keeps an already-published row published.
        .onConflictDoNothing();
    });
  }

  /** Records what the projection references; dropped assets keep their row, unflagged. */
  async recordPublished(contentId: string, spaceId: string, assetIds: string[]): Promise<void> {
    const { assetUsages } = this.t;
    const unique = [...new Set(assetIds)];

    await this.db.transaction(async (tx) => {
      await tx
        .update(assetUsages)
        .set({ published: false, updatedAt: new Date() })
        .where(
          and(
            eq(assetUsages.contentId, contentId),
            ...(unique.length > 0 ? [notInArray(assetUsages.assetId, unique)] : []),
          ),
        );

      if (unique.length === 0) return;

      await tx
        .insert(assetUsages)
        .values(
          unique.map((assetId) => ({
            assetId,
            contentId,
            spaceId,
            environmentId: this.environmentOfContent(contentId),
            published: true,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [assetUsages.assetId, assetUsages.contentId],
          set: { published: true, updatedAt: new Date() },
        });
    });
  }

  /** Revokes every asset these documents kept public. */
  async clearPublished(contentIds: string | readonly string[]): Promise<void> {
    const ids = typeof contentIds === 'string' ? [contentIds] : contentIds;
    if (ids.length === 0) return;
    const { assetUsages } = this.t;
    for (const batch of batches(ids, 1, this.dialect.maxParameters)) {
      await this.db
        .update(assetUsages)
        .set({ published: false, updatedAt: new Date() })
        .where(inArray(assetUsages.contentId, batch));
    }
  }

  async deleteByContent(contentIds: string | readonly string[]): Promise<boolean> {
    const ids = typeof contentIds === 'string' ? [contentIds] : contentIds;
    const { assetUsages } = this.t;
    let removed = false;
    for (const batch of batches(ids, 1, this.dialect.maxParameters)) {
      if (await this.removeWhere(assetUsages, inArray(assetUsages.contentId, batch)))
        removed = true;
    }
    return removed;
  }

  /** The environment of a draft, as a subquery. */
  private environmentOfContent(contentId: string): SQL {
    const { contents } = this.t;
    return sql`(select ${contents.environmentId} from ${contents} where ${contents.id} = ${contentId})`;
  }

  async count(): Promise<number> {
    const { assetUsages } = this.t;
    const rows = await this.db.select({ count: count() }).from(assetUsages);
    return rows[0]?.count ?? 0;
  }
}

/** A usage's environment is a production one, or the staging environment `stagingId`. */
export function publishedIn(t: Tables, stagingId?: string | null): SQL {
  const production = inProduction(t, t.assetUsages);
  return stagingId
    ? sql`(${eq(t.assetUsages.environmentId, stagingId)} or ${production})`
    : production;
}
