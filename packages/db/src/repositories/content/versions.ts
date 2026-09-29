import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { batches } from '../../batch.js';
import type { Executor } from '../../client.js';
import { firstPage, type Paginated, paginate } from '../../pagination.js';
import type { Pagination } from '../../query.js';
import type { ContentRow, ContentVersionRow } from '../../schema/index.js';
import { ContentBase } from './shared.js';

/** One stored version of a document. */
export interface VersionEntry {
  version: number;
  label: string | null;
  snapshot: Record<string, unknown>;
  createdAt: Date;
  createdBy: string | null;
}

/** A version without its snapshot. */
export type ContentVersionSummary = Omit<VersionEntry, 'snapshot'>;

/** Snapshots and history restore. */
export class ContentVersions extends ContentBase {
  /**
   * A page of a document's versions without snapshots, newest first; with `since`, older ones
   * only when a keep rule holds them.
   */
  pageVersions(
    contentId: string,
    pagination: Pagination = firstPage(),
    since: Date | null = null,
  ): Promise<Paginated<ContentVersionSummary>> {
    const { contentVersions } = this.t;
    return paginate<ContentVersionSummary>(this.db, contentVersions, {
      columns: {
        version: contentVersions.version,
        createdAt: contentVersions.createdAt,
        createdBy: contentVersions.createdBy,
        label: contentVersions.label,
      },
      where: and(
        eq(contentVersions.contentId, contentId),
        since ? or(gte(contentVersions.createdAt, since), this.keptVersion()) : undefined,
      ),
      orderBy: desc(contentVersions.version),
      pagination,
    });
  }

  /**
   * Deletes up to `limit` of the space's versions older than `before`, oldest first, except
   * those a keep rule holds; returns how many went.
   */
  async pruneVersions(spaceId: string, before: Date, limit: number): Promise<number> {
    const { contents, contentVersions } = this.t;
    const due = this.db
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .innerJoin(contents, eq(contents.id, contentVersions.contentId))
      .where(
        and(
          eq(contents.spaceId, spaceId),
          lt(contentVersions.createdAt, before),
          not(this.keptVersion()),
        ),
      )
      .orderBy(asc(contentVersions.createdAt))
      .limit(limit);
    const rows = await this.db
      .delete(contentVersions)
      .where(inArray(contentVersions.id, due))
      .returning({ id: contentVersions.id });
    return rows.length;
  }

  /** The newest version, the published one, and those an open approval refers to. */
  private keptVersion(): SQL {
    const { contentVersions: v, publishedContents: p, contentApprovals: a } = this.t;
    return sql`(not exists (select 1 from content_versions newer where newer.content_id = ${v.contentId} and newer.version > ${v.version})
      or exists (select 1 from ${p} where ${p.id} = ${v.contentId} and ${p.sourceVersion} = ${v.version})
      or exists (select 1 from ${a} where ${a.contentId} = ${v.contentId} and ${a.status} = 'pending' and ${a.contentVersion} = ${v.version}))`;
  }

  /** The full row as it was at that version. */
  async findVersionSnapshot(contentId: string, version: number): Promise<ContentRow | null> {
    const { contentVersions } = this.t;
    const rows = await this.db
      .select({ snapshot: contentVersions.snapshot })
      .from(contentVersions)
      .where(and(eq(contentVersions.contentId, contentId), eq(contentVersions.version, version)))
      .limit(1);
    return (rows[0]?.snapshot as ContentRow | undefined) ?? null;
  }

  /** Every stored version of these documents, oldest first, for a space export. */
  async listVersions(contentIds: string[]): Promise<ContentVersionRow[]> {
    const { contentVersions } = this.t;
    const out: ContentVersionRow[] = [];
    for (const batch of batches(contentIds, 1, this.dialect.maxParameters)) {
      out.push(
        ...(await this.db
          .select()
          .from(contentVersions)
          .where(inArray(contentVersions.contentId, batch))
          .orderBy(contentVersions.contentId, contentVersions.version)),
      );
    }
    return out;
  }

  /** Restores an imported document's version counter, timestamps and history. */
  async restoreHistory(
    id: string,
    data: { version: number; createdAt: Date; updatedAt: Date; versions: VersionEntry[] },
  ): Promise<void> {
    const { contents, contentVersions } = this.t;
    await this.db.transaction(async (tx) => {
      await tx
        .update(contents)
        .set({ version: data.version, createdAt: data.createdAt, updatedAt: data.updatedAt })
        .where(eq(contents.id, id));
      if (data.versions.length === 0) return;
      await tx.delete(contentVersions).where(eq(contentVersions.contentId, id));
      await tx
        .insert(contentVersions)
        .values(data.versions.map((version) => ({ ...version, contentId: id })));
    });
  }

  /** `restoreHistory` for a whole import, batched. */
  async restoreHistoryMany(
    entries: Array<{
      id: string;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      versions: VersionEntry[];
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const { contentVersions } = this.t;
    const d = this.dialect;
    const ids = entries.map((entry) => entry.id);
    const withVersions = entries.filter((entry) => entry.versions.length > 0);
    const versionColumns = Object.keys(getTableColumns(contentVersions)).length;

    // Sliced to stay under the parameter ceiling.
    await this.db.transaction(async (tx) => {
      for (const batch of batches(entries, 4, d.maxParameters)) {
        const values = d.values(
          { id: 'uuid', version: 'int', created_at: 'timestamptz', updated_at: 'timestamptz' },
          batch.map((entry) => ({
            id: entry.id,
            version: entry.version,
            created_at: entry.createdAt,
            updated_at: entry.updatedAt,
          })),
        );
        await d.run(
          tx,
          sql`
          update contents
          set version = v.version, created_at = v.created_at, updated_at = v.updated_at
          from ${values} v
          where contents.id = v.id
        `,
        );
      }

      if (withVersions.length === 0) return;
      for (const batch of batches(ids, 1, d.maxParameters)) {
        await tx.delete(contentVersions).where(inArray(contentVersions.contentId, batch));
      }
      const rows = withVersions.flatMap((entry) =>
        entry.versions.map((version) => ({ ...version, contentId: entry.id })),
      );
      for (const batch of batches(rows, versionColumns, d.maxParameters)) {
        await tx.insert(contentVersions).values(batch);
      }
    });
  }

  /** Records `row` as its own version; an existing version number is left alone. */
  async snapshot(db: Executor, row: ContentRow, actorId: string | null): Promise<void> {
    const { contentVersions } = this.t;
    await db
      .insert(contentVersions)
      .values({
        contentId: row.id,
        version: row.version,
        snapshot: row as unknown as Record<string, unknown>,
        createdBy: actorId,
      })
      .onConflictDoNothing();
  }
}
