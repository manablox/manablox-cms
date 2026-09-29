import { ManabloxError } from '@manablox/core';
import {
  and,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import { batches } from '../../batch.js';
import { DUE_PUBLICATION_BATCH } from '../../pagination.js';
import type { ContentTable } from '../../query.js';
import type { ContentRow } from '../../schema/index.js';
import type { Tables } from '../../tables.js';
import type { DatabaseContext } from '../base.js';
import { ContentBase } from './shared.js';
import type { ContentTree } from './tree.js';

/** A live document's permalink, as `publishedPermalinks` reads it. */
export interface PublishedPermalink {
  id: string;
  localizationId: string;
  locale: string;
  permalink: string | null;
  permalinkPath: string;
}

const projections = new WeakMap<Tables, string[]>();

/** Columns `publish()` copies: every column both tables share, plus `source_version`. */
function projectionColumns(t: Tables): string[] {
  const cached = projections.get(t);
  if (cached) return cached;
  // `column.name` is the TypeScript key; snake_case is applied only at query build time.
  const columnNames = (table: ContentTable) =>
    Object.values(getTableColumns(table))
      // `search` is generated; the database refuses an explicit value for it.
      .filter((column) => column.generated === undefined)
      .map((column) =>
        column.name.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`),
      );
  const draft = new Set(columnNames(t.contents));
  const columns = columnNames(t.publishedContents).filter(
    (name) => draft.has(name) || name === 'source_version',
  );
  projections.set(t, columns);
  return columns;
}

/** Columns that identify the row and are never rewritten on a republish. */
const PROJECTION_IDENTITY = new Set([
  'id',
  'space_id',
  'environment_id',
  'localization_id',
  'created_at',
  'created_by',
]);

/** Projection into `published_contents`, scheduling and publish dates. */
export class ContentPublishing extends ContentBase {
  constructor(
    context: DatabaseContext,
    private readonly tree: ContentTree,
  ) {
    super(context);
  }

  /** Copies a draft into the projection atomically. */
  async publish(id: string, actorId: string | null = null): Promise<ContentRow> {
    const { contents, publishedContents } = this.t;
    const d = this.dialect;
    return this.db.transaction(async (tx) => {
      const row = await this.findRow(tx, id);
      if (!row) throw ManabloxError.notFound('content.notFound', { id });

      // An unchanged `permalink_path` means no descendant permalink went stale.
      const previous = (
        await tx
          .select({ permalinkPath: publishedContents.permalinkPath })
          .from(publishedContents)
          .where(eq(publishedContents.id, id))
          .limit(1)
      )[0];

      const publishedAt = new Date();

      const overrides: Record<string, SQL> = {
        status: sql`'published'`,
        source_version: sql`version`,
        updated_at: d.now(),
        updated_by: d.param(actorId, 'uuid'),
        published_at: d.param(publishedAt, 'timestamptz'),
        // A projected row has no pending publish date; `unpublish_at` is copied.
        publish_at: sql`null`,
      };
      const projected = projectionColumns(this.t);
      const columns = projected.map((name) => sql.identifier(name));
      const values = projected.map((name) => overrides[name] ?? sql.identifier(name));
      const updates = projected
        .filter((name) => !PROJECTION_IDENTITY.has(name))
        .map((name) => sql`${sql.identifier(name)} = excluded.${sql.identifier(name)}`);

      await d.run(
        tx,
        sql`
        insert into published_contents (${sql.join(columns, sql`, `)})
        select ${sql.join(values, sql`, `)}
        from contents where id = ${d.param(id, 'uuid')}
        on conflict (id) do update set ${sql.join(updates, sql`, `)}
      `,
      );

      if (previous?.permalinkPath !== row.permalinkPath) {
        await this.tree.recomputePermalinks(tx, publishedContents, id);
      }

      const [updated] = await tx
        .update(contents)
        // Publishing spends a pending publish date; `unpublishAt` stays.
        .set({ status: 'published', publishedAt, publishAt: null, updatedBy: actorId })
        .where(eq(contents.id, id))
        .returning();

      return updated as ContentRow;
    });
  }

  /**
   * Live permalinks of a node, and with `subtree` of its live descendants, found by parent so
   * a moved node still takes its old children along.
   */
  async publishedPermalinks(id: string, subtree: boolean): Promise<PublishedPermalink[]> {
    const d = this.dialect;
    const node = d.param(id, 'uuid');
    const query = subtree
      ? sql`
        with recursive t as (
          select id, localization_id, locale, permalink, permalink_path
          from published_contents where id = ${node}
          union all
          select c.id, c.localization_id, c.locale, c.permalink, c.permalink_path
          from published_contents c join t on c.parent_id = t.id
        )
        select id, localization_id, locale, permalink, permalink_path from t`
      : sql`select id, localization_id, locale, permalink, permalink_path
          from published_contents where id = ${node}`;
    const rows = await d.rows<{
      id: string;
      localization_id: string;
      locale: string;
      permalink: string | null;
      permalink_path: string;
    }>(this.db, query);
    return rows.map((row) => ({
      id: row.id,
      localizationId: row.localization_id,
      locale: row.locale,
      permalink: row.permalink,
      permalinkPath: row.permalink_path,
    }));
  }

  /**
   * Removes the live copies of a node and its descendants and sets each of their drafts back
   * to `draft`. Returns those drafts, the node first.
   */
  async unpublish(id: string): Promise<ContentRow[]> {
    const { contents } = this.t;
    const d = this.dialect;
    return this.db.transaction(async (tx) => {
      const removed = await d.rows<{ id: string }>(
        tx,
        sql`delete from published_contents
          where ${d.pathWithin(sql`path`, this.pathOf(sql`contents`, id))}
          returning id`,
      );
      const ids = [id, ...removed.map((row) => row.id).filter((removedId) => removedId !== id)];
      const rows = (await tx
        .update(contents)
        .set({ status: 'draft', publishedAt: null, unpublishAt: null })
        .where(inArray(contents.id, ids))
        .returning()) as ContentRow[];
      return rows.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0));
    });
  }

  /** Sets schedule dates; an omitted key is left alone, `null` clears. */
  async setSchedule(
    id: string,
    schedule: { publishAt?: Date | null | undefined; unpublishAt?: Date | null | undefined },
  ): Promise<ContentRow> {
    const { contents } = this.t;
    const [row] = await this.db
      .update(contents)
      .set({
        ...(schedule.publishAt !== undefined ? { publishAt: schedule.publishAt } : {}),
        ...(schedule.unpublishAt !== undefined ? { unpublishAt: schedule.unpublishAt } : {}),
      })
      .where(eq(contents.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('content.notFound', { id });
    return row as ContentRow;
  }

  /**
   * Claims due publications by clearing their date, so racing schedulers cannot both take
   * a row. A failure after the claim drops the schedule on purpose, to avoid a retry storm.
   */
  claimDuePublications(now: Date, limit = DUE_PUBLICATION_BATCH): Promise<ContentRow[]> {
    return this.claimDue('publishAt', now, limit);
  }

  /** Claims due unpublications. */
  claimDueUnpublications(now: Date, limit = DUE_PUBLICATION_BATCH): Promise<ContentRow[]> {
    return this.claimDue('unpublishAt', now, limit);
  }

  private async claimDue(
    field: 'publishAt' | 'unpublishAt',
    now: Date,
    limit: number,
  ): Promise<ContentRow[]> {
    const { contents, spaces } = this.t;
    const column = contents[field];
    const due = await this.db
      .select({ id: contents.id })
      .from(contents)
      // Waits until the space's import finished.
      .innerJoin(spaces, eq(spaces.id, contents.spaceId))
      .where(and(isNotNull(column), lte(column, now), isNull(spaces.importStatus)))
      .orderBy(column)
      .limit(limit);
    if (due.length === 0) return [];

    // `is not null` makes this a claim: a racing update re-checks it and matches nothing.
    const rows = await this.db
      .update(contents)
      .set({ [field]: null })
      .where(
        and(
          inArray(
            contents.id,
            due.map((row) => row.id),
          ),
          isNotNull(column),
        ),
      )
      .returning();
    return rows as ContentRow[];
  }

  /** `restoreDates` for a whole import, batched; `null` clears a date. */
  async restoreDatesMany(
    entries: Array<{
      id: string;
      publishedAt: Date | null;
      publishAt: Date | null;
      unpublishAt: Date | null;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const d = this.dialect;
    const valuesOf = (slice: typeof entries) =>
      d.values(
        {
          id: 'uuid',
          published_at: 'timestamptz',
          publish_at: 'timestamptz',
          unpublish_at: 'timestamptz',
        },
        slice.map((entry) => ({
          id: entry.id,
          published_at: entry.publishedAt,
          publish_at: entry.publishAt,
          unpublish_at: entry.unpublishAt,
        })),
      );

    // Sliced for the parameter ceiling.
    await this.db.transaction(async (tx) => {
      for (const batch of batches(entries, 4, d.maxParameters)) {
        const values = valuesOf(batch);
        await d.run(
          tx,
          sql`
          update contents
          set published_at = v.published_at, publish_at = v.publish_at, unpublish_at = v.unpublish_at
          from ${values} v
          where contents.id = v.id
        `,
        );
        // A projected row is published already, so its `publish_at` stays null.
        await d.run(
          tx,
          sql`
          update published_contents
          set published_at = v.published_at, unpublish_at = v.unpublish_at
          from ${values} v
          where published_contents.id = v.id
        `,
        );
      }
    });
  }

  /** Restores an import's publish and schedule dates, in draft and projection. */
  async restoreDates(
    id: string,
    data: {
      publishedAt?: Date | null | undefined;
      publishAt?: Date | null | undefined;
      unpublishAt?: Date | null | undefined;
    },
  ): Promise<void> {
    const draft = {
      ...(data.publishedAt !== undefined ? { publishedAt: data.publishedAt } : {}),
      ...(data.publishAt !== undefined ? { publishAt: data.publishAt } : {}),
      ...(data.unpublishAt !== undefined ? { unpublishAt: data.unpublishAt } : {}),
    };
    if (Object.keys(draft).length === 0) return;
    const { contents, publishedContents } = this.t;
    await this.db.transaction(async (tx) => {
      await tx.update(contents).set(draft).where(eq(contents.id, id));
      // A projected row is published already, so its `publish_at` stays null.
      const { publishAt: _spent, ...projected } = draft;
      if (Object.keys(projected).length) {
        await tx.update(publishedContents).set(projected).where(eq(publishedContents.id, id));
      }
    });
  }
}
