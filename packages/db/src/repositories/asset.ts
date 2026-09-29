import { type Loose, ManabloxError } from '@manablox/core';
import { and, desc, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { Database, Executor } from '../client.js';
import { escapeLike } from '../dialect.js';
import { keysetBatches, type Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { AssetRow, AssetVariantRow } from '../schema/index.js';
import { publishedIn } from './asset-usage.js';
import { Repository } from './base.js';
import { addTotals } from './limit-count.js';

export interface AssetWriteData {
  id?: string | undefined;
  /** The first space it appears in. */
  spaceId: string;
  driver: string;
  key: string;
  filename: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number | null | undefined;
  height?: number | null | undefined;
  duration?: number | null | undefined;
  checksum?: string | null | undefined;
  alt?: string | null | undefined;
  title?: string | null | undefined;
  /** Availability window. */
  publishAt?: Date | null | undefined;
  unpublishAt?: Date | null | undefined;
  meta?: Record<string, unknown> | undefined;
  actorId?: string | null | undefined;
}

export interface AssetFilter {
  spaceId: string;
  /** Prefix match on the mime type, e.g. `image/`. */
  mimeType?: string | undefined;
  /** Mime type prefixes to leave out, e.g. `['image/']`. */
  mimeTypeNot?: string[] | undefined;
  /** Matches the name, the file name or a tag. */
  search?: string | undefined;
  /** Tag ids; an asset carrying any of them is kept. */
  tagIds?: string[] | undefined;
  /** Tag slugs, for callers that name tags rather than hold their ids. */
  tagSlugs?: string[] | undefined;
  /** Only assets a published document references. */
  published?: boolean | undefined;
  /** With `published`, a staging environment whose documents count besides production's. */
  stagingId?: string | null | undefined;
}

export class AssetRepository extends Repository {
  /** Whether the asset on the row being read carries a tag `condition` accepts, within `spaceId`. */
  private hasTag(spaceId: string, condition: SQL): SQL {
    const { assets } = this.t;
    return sql`exists (
      select 1 from asset_tags atg
      inner join tags tg on tg.id = atg.tag_id
      where atg.asset_id = ${assets.id} and tg.space_id = ${this.dialect.param(spaceId, 'uuid')}
        and ${condition}
    )`;
  }

  /** Whether the asset on the row being read appears in `spaceId`. */
  private inSpace(spaceId: string): SQL {
    const { assetSpaces, assets } = this.t;
    return sql`exists (select 1 from ${assetSpaces} where ${assetSpaces.assetId} = ${assets.id} and ${assetSpaces.spaceId} = ${spaceId})`;
  }

  /** `spaceId` is a tenant boundary; without it any asset id resolves. */
  findById(id: string, spaceId?: string | null): Promise<AssetRow | null> {
    const { assets } = this.t;
    return this.findOneWhere(
      assets,
      spaceId ? and(eq(assets.id, id), this.inSpace(spaceId)) : eq(assets.id, id),
    );
  }

  /** `spaceId` is a tenant boundary; without it any asset id resolves. */
  async listByIds(ids: string[], spaceId?: string | null): Promise<AssetRow[]> {
    const { assets } = this.t;
    const out: AssetRow[] = [];
    for (const batch of batches(ids, 1, this.dialect.maxParameters)) {
      const where = spaceId
        ? and(inArray(assets.id, batch), this.inSpace(spaceId))
        : inArray(assets.id, batch);
      out.push(...(await this.db.select().from(assets).where(where)));
    }
    return out;
  }

  /** The space the asset's bytes count in, or `null` when it is in none. */
  ownerSpaceId(assetId: string): Promise<string | null> {
    return this.ownerOf(this.db, assetId);
  }

  /** Dedupe within a space only, so other spaces' files do not leak. */
  findByChecksum(spaceId: string, checksum: string): Promise<AssetRow | null> {
    const { assets } = this.t;
    return this.findOneWhere(assets, and(eq(assets.checksum, checksum), this.inSpace(spaceId)));
  }

  async page(filter: AssetFilter, pagination: Pagination): Promise<Paginated<AssetRow>> {
    const { assets } = this.t;
    const conditions = [this.inSpace(filter.spaceId)];
    if (filter.mimeType) {
      conditions.push(this.dialect.ilike(assets.mimeType, `${escapeLike(filter.mimeType)}%`));
    }
    for (const prefix of filter.mimeTypeNot ?? []) {
      conditions.push(sql`not (${this.dialect.ilike(assets.mimeType, `${escapeLike(prefix)}%`)})`);
    }
    if (filter.search) {
      const term = `%${escapeLike(filter.search)}%`;
      conditions.push(
        or(
          this.dialect.ilike(assets.name, term),
          this.dialect.ilike(assets.filename, term),
          // Tags are part of what an asset is called, so free text finds them too.
          this.hasTag(filter.spaceId, this.dialect.ilike(sql`tg.name`, term)),
        ) as SQL,
      );
    }
    if (filter.tagIds?.length) {
      const ids = sql.join(
        filter.tagIds.map((id) => this.dialect.param(id, 'uuid')),
        sql`, `,
      );
      conditions.push(this.hasTag(filter.spaceId, sql`atg.tag_id in (${ids})`));
    }
    if (filter.tagSlugs?.length) {
      const slugs = sql.join(
        filter.tagSlugs.map((slug) => this.dialect.param(slug, 'text')),
        sql`, `,
      );
      conditions.push(this.hasTag(filter.spaceId, sql`tg.slug in (${slugs})`));
    }
    if (filter.published) {
      const { assetUsages } = this.t;
      conditions.push(
        sql`exists (select 1 from ${assetUsages} where ${assetUsages.assetId} = ${assets.id} and ${eq(assetUsages.published, true)} and ${publishedIn(this.t, filter.stagingId)})`,
      );
    }

    return this.paginate(assets, and(...conditions), desc(assets.createdAt), pagination);
  }

  /** Every asset of the space in batches, in `page`'s order (newest first), by keyset. */
  batches(spaceId: string, batch = 500): AsyncGenerator<AssetRow[]> {
    const { assets } = this.t;
    return keysetBatches<AssetRow>(this.db, assets, {
      where: this.inSpace(spaceId),
      order: [{ column: assets.createdAt, desc: true }],
      batch,
    });
  }

  /** Inserts the asset with its first space atomically. */
  async create(data: AssetWriteData): Promise<AssetRow> {
    const { assetSpaces, assets } = this.t;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(assets)
        .values({
          ...(data.id ? { id: data.id } : {}),
          driver: data.driver,
          key: data.key,
          filename: data.filename,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size,
          width: data.width ?? null,
          height: data.height ?? null,
          duration: data.duration ?? null,
          checksum: data.checksum ?? null,
          alt: data.alt ?? null,
          title: data.title ?? null,
          publishAt: data.publishAt ?? null,
          unpublishAt: data.unpublishAt ?? null,
          meta: data.meta ?? {},
          createdBy: data.actorId ?? null,
        })
        .returning();
      if (!row) throw new ManabloxError('asset.create.failed');
      await tx.insert(assetSpaces).values({ assetId: row.id, spaceId: data.spaceId });
      await this.countBytes(tx, data.spaceId, row.size);
      return row;
    });
  }

  /** The spaces each asset appears in, keyed by asset id; an unknown id is absent. */
  async listSpaceIdsByAssets(assetIds: string[]): Promise<Map<string, string[]>> {
    const { assetSpaces } = this.t;
    const out = new Map<string, string[]>();
    if (assetIds.length === 0) return out;
    const rows = await this.db
      .select({ assetId: assetSpaces.assetId, spaceId: assetSpaces.spaceId })
      .from(assetSpaces)
      .where(inArray(assetSpaces.assetId, assetIds))
      .orderBy(assetSpaces.createdAt);
    for (const row of rows) {
      const list = out.get(row.assetId);
      if (list) list.push(row.spaceId);
      else out.set(row.assetId, [row.spaceId]);
    }
    return out;
  }

  /** Replaces the asset's spaces; the caller checks permissions. */
  async setSpaces(assetId: string, spaceIds: string[]): Promise<void> {
    const { assetSpaces } = this.t;
    if (spaceIds.length === 0) throw ManabloxError.badRequest('asset.spaces.required');
    await this.movingOwner(assetId, async (tx) => {
      await tx
        .delete(assetSpaces)
        .where(and(eq(assetSpaces.assetId, assetId), notInArray(assetSpaces.spaceId, spaceIds)));
      await tx
        .insert(assetSpaces)
        .values(spaceIds.map((spaceId) => ({ assetId, spaceId })))
        .onConflictDoNothing();
    });
  }

  /** Adds one space; idempotent. */
  async addToSpace(assetId: string, spaceId: string): Promise<void> {
    const { assetSpaces } = this.t;
    await this.movingOwner(assetId, async (tx) => {
      await tx.insert(assetSpaces).values({ assetId, spaceId }).onConflictDoNothing();
    });
  }

  async removeFromSpace(assetId: string, spaceId: string): Promise<void> {
    const { assetSpaces } = this.t;
    await this.movingOwner(assetId, async (tx) => {
      await tx
        .delete(assetSpaces)
        .where(and(eq(assetSpaces.assetId, assetId), eq(assetSpaces.spaceId, spaceId)));
    });
  }

  /** Deletes and returns assets that belong to no space. */
  async deleteOrphanedReturning(): Promise<AssetRow[]> {
    const { assetSpaces, assets } = this.t;
    return this.db
      .delete(assets)
      .where(
        sql`not exists (select 1 from ${assetSpaces} where ${assetSpaces.assetId} = ${assets.id})`,
      )
      .returning();
  }

  async update(
    id: string,
    data: Loose<
      Pick<AssetWriteData, 'name' | 'alt' | 'title' | 'publishAt' | 'unpublishAt' | 'meta'>
    >,
  ): Promise<AssetRow> {
    const { assets } = this.t;
    const [row] = await this.db
      .update(assets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(assets.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('asset.notFound', { id });
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const { assets } = this.t;
    return this.db.transaction(async (tx) => {
      const owner = await this.ownerOf(tx, id);
      const bytes = owner ? await this.bytesOf(tx, id) : 0;
      const rows = await tx.delete(assets).where(eq(assets.id, id)).returning({ id: assets.id });
      if (owner && rows.length > 0) await this.countBytes(tx, owner, -bytes);
      return rows.length > 0;
    });
  }

  /** Restores an import's original timestamps. */
  async restoreTimestamps(id: string, createdAt: Date, updatedAt: Date): Promise<void> {
    const { assets } = this.t;
    await this.db.update(assets).set({ createdAt, updatedAt }).where(eq(assets.id, id));
  }

  async listVariantsByAssets(assetIds: string[]): Promise<AssetVariantRow[]> {
    const { assetVariants } = this.t;
    if (assetIds.length === 0) return [];
    return this.db.select().from(assetVariants).where(inArray(assetVariants.assetId, assetIds));
  }

  findVariant(assetId: string, preset: string, format: string): Promise<AssetVariantRow | null> {
    const { assetVariants } = this.t;
    return this.findOneWhere(
      assetVariants,
      and(
        eq(assetVariants.assetId, assetId),
        eq(assetVariants.preset, preset),
        eq(assetVariants.format, format),
      ),
    );
  }

  /** Drops every variant row; the caller removes the files. */
  async deleteVariantsByAsset(assetId: string): Promise<boolean> {
    const { assetVariants } = this.t;
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(assetVariants)
        .where(eq(assetVariants.assetId, assetId))
        .returning({ size: assetVariants.size });
      const owner = rows.length > 0 ? await this.ownerOf(tx, assetId) : null;
      if (owner) await this.countBytes(tx, owner, -rows.reduce((sum, row) => sum + row.size, 0));
      return rows.length > 0;
    });
  }

  async upsertVariant(data: {
    assetId: string;
    preset: string;
    format: string;
    key: string;
    width?: number | null;
    height?: number | null;
    size: number;
  }): Promise<AssetVariantRow> {
    const { assetVariants } = this.t;
    return this.db.transaction(async (tx) => {
      const previous = await tx
        .select({ size: assetVariants.size })
        .from(assetVariants)
        .where(
          and(
            eq(assetVariants.assetId, data.assetId),
            eq(assetVariants.preset, data.preset),
            eq(assetVariants.format, data.format),
          ),
        );
      const row = await this.writeVariant(tx, data);
      const owner = await this.ownerOf(tx, data.assetId);
      if (owner) await this.countBytes(tx, owner, row.size - (previous[0]?.size ?? 0));
      return row;
    });
  }

  private async writeVariant(
    tx: Executor,
    data: Parameters<AssetRepository['upsertVariant']>[0],
  ): Promise<AssetVariantRow> {
    const { assetVariants } = this.t;
    const [row] = await tx
      .insert(assetVariants)
      .values({
        assetId: data.assetId,
        preset: data.preset,
        format: data.format,
        key: data.key,
        width: data.width ?? null,
        height: data.height ?? null,
        size: data.size,
      })
      .onConflictDoUpdate({
        target: [assetVariants.assetId, assetVariants.preset, assetVariants.format],
        set: { key: data.key, size: data.size },
      })
      .returning();
    if (!row) throw new ManabloxError('assetVariant.create.failed');
    return row;
  }

  /** Runs `write`, moving the asset's bytes when its owning space changes. */
  private async movingOwner(assetId: string, write: (tx: Executor) => Promise<void>) {
    await this.db.transaction(async (tx) => {
      const before = await this.ownerOf(tx, assetId);
      await write(tx);
      const after = await this.ownerOf(tx, assetId);
      if (before === after) return;
      const bytes = await this.bytesOf(tx, assetId);
      if (before) await this.countBytes(tx, before, -bytes);
      if (after) await this.countBytes(tx, after, bytes);
    });
  }

  /** The space the asset's bytes count in, or `null` when it is in none. */
  private async ownerOf(tx: Executor, assetId: string): Promise<string | null> {
    const { assetSpaces } = this.t;
    // The order `LimitCountRepository.totals` uses.
    const [row] = await tx
      .select({ spaceId: assetSpaces.spaceId })
      .from(assetSpaces)
      .where(eq(assetSpaces.assetId, assetId))
      .orderBy(assetSpaces.createdAt, assetSpaces.spaceId)
      .limit(1);
    return row?.spaceId ?? null;
  }

  /** The original's and its variants' bytes. */
  private async bytesOf(tx: Executor, assetId: string): Promise<number> {
    const { assets, assetVariants } = this.t;
    const [original] = await tx
      .select({ size: assets.size })
      .from(assets)
      .where(eq(assets.id, assetId));
    const [variants] = await tx
      .select({ size: sql<number>`coalesce(sum(${assetVariants.size}), 0)`.mapWith(Number) })
      .from(assetVariants)
      .where(eq(assetVariants.assetId, assetId));
    return (original?.size ?? 0) + (variants?.size ?? 0);
  }

  private async countBytes(tx: Executor, spaceId: string, delta: number): Promise<void> {
    await addTotals(
      { db: tx as Database, tables: this.t, dialect: this.dialect, unit: this.unit },
      [{ spaceId, metric: 'storageBytes', delta }],
    );
  }
}
