import {
  type ContentStatus,
  type ContentTypeRegistry,
  nominationsOf,
  type Scope,
  scopeSpaceId,
} from '@manablox/core';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { batches } from '../../batch.js';
import { keysetBatches, type Paginated, paginate } from '../../pagination.js';
import {
  buildContentWhere,
  buildOrderBy,
  type ContentFilter,
  type ContentSort,
  keysetOrder,
  type Pagination,
} from '../../query.js';
import type { ContentRow } from '../../schema/index.js';
import { type DatabaseContext, inProduction } from '../base.js';
import { productionIds } from '../environment.js';
import { ContentBase, siblingOrder } from './shared.js';

/** Documents per round trip of a walk over a whole space. */
const WALK_BATCH = 1000;

/** Lookups and listings over the draft and published tables. */
export class ContentReads extends ContentBase {
  constructor(
    context: DatabaseContext,
    private readonly registry: ContentTypeRegistry,
  ) {
    super(context);
  }

  /** Every document a config owns in an environment, for the reconciler's prune pass. */
  async listCodeBySpace(scope: Scope): Promise<ContentRow[]> {
    const { contents } = this.t;
    const rows = await this.db
      .select()
      .from(contents)
      .where(and(this.inEnvironment(contents, scope), eq(contents.source, 'code')));
    return rows as ContentRow[];
  }

  /** `listCodeBySpace` for many spaces, keyed by space id; `all` takes every environment. */
  listCodeBySpaces(
    spaceIds: readonly string[],
    environments: 'production' | 'all' = 'production',
  ): Promise<Map<string, ContentRow[]>> {
    const { contents } = this.t;
    return this.bySpaces(
      spaceIds,
      (batch) =>
        this.db
          .select()
          .from(contents)
          .where(
            and(
              inArray(contents.spaceId, batch),
              eq(contents.source, 'code'),
              environments === 'all' ? undefined : inProduction(this.t, contents),
            ),
          ) as Promise<ContentRow[]>,
    );
  }

  findById(id: string, published = false): Promise<ContentRow | null> {
    const table = this.table(published);
    return this.findContentWhere(table, eq(table.id, id));
  }

  /** `scope` bounds the lookup to one environment; delivery takes ids from the caller. */
  async listByIds(ids: string[], published = false, scope?: Scope | null): Promise<ContentRow[]> {
    const table = this.table(published);
    const out: ContentRow[] = [];
    for (const batch of batches(ids, 1, this.dialect.maxParameters - 2)) {
      const where = scope
        ? and(inArray(table.id, batch), this.inEnvironment(table, scope))
        : inArray(table.id, batch);
      out.push(
        ...((await this.db
          .select(this.readColumns(table))
          .from(table)
          .where(where)) as unknown as ContentRow[]),
      );
    }
    return out;
  }

  /** Children of many parents in one query, for the tree loader. */
  async listByParents(
    parentIds: string[],
    published = false,
    scope?: Scope | null,
  ): Promise<ContentRow[]> {
    if (parentIds.length === 0) return [];
    const table = this.table(published);
    const where = scope
      ? and(inArray(table.parentId, parentIds), this.inEnvironment(table, scope))
      : inArray(table.parentId, parentIds);
    return this.db
      .select(this.readColumns(table))
      .from(table)
      .where(where)
      .orderBy(siblingOrder(table)) as unknown as Promise<ContentRow[]>;
  }

  async findByPermalink(
    scope: Scope,
    locale: string,
    permalink: string,
    published = true,
  ): Promise<ContentRow | null> {
    // The root path names no document of its own; the space says which one it is.
    if (permalink === '') return this.findHome(scope, locale, published);

    const table = this.table(published);
    return this.findContentWhere(
      table,
      and(
        this.inEnvironment(table, scope),
        eq(table.locale, locale),
        eq(table.permalink, permalink),
      ),
    );
  }

  /**
   * An environment's home document in one locale, resolved via the nominated row's
   * `localizationId`; each environment nominates its own.
   */
  async findHome(scope: Scope, locale: string, published = true): Promise<ContentRow | null> {
    const { contents, spaces } = this.t;
    const spaceId = scopeSpaceId(scope);
    const [space] = await this.db
      .select({ settings: spaces.settings })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);

    const staging =
      typeof scope !== 'string' &&
      !(await productionIds(this.db, this.t, [scope.environmentId])).has(scope.environmentId)
        ? scope.environmentId
        : null;
    const homeId = nominationsOf(space?.settings, staging).homeContentId;
    if (!homeId) return null;

    // Always from `contents`: the nominated row may be unpublished.
    const [nominated] = await this.db
      .select({ localizationId: contents.localizationId })
      .from(contents)
      .where(and(eq(contents.id, homeId), this.inEnvironment(contents, scope)))
      .limit(1);
    if (!nominated) return null;

    const table = this.table(published);
    return this.findContentWhere(
      table,
      and(
        this.inEnvironment(table, scope),
        eq(table.locale, locale),
        eq(table.localizationId, nominated.localizationId),
      ),
    );
  }

  /** One document per localization group (first locale by sort order). */
  async listByLocalizationIds(scope: Scope, localizationIds: string[]): Promise<ContentRow[]> {
    if (localizationIds.length === 0) return [];
    const { contents } = this.t;
    const rows = await this.db
      .select()
      .from(contents)
      .where(
        and(this.inEnvironment(contents, scope), inArray(contents.localizationId, localizationIds)),
      )
      .orderBy(contents.localizationId, contents.locale);
    const seen = new Set<string>();
    return (rows as unknown as ContentRow[]).filter((row) => {
      if (seen.has(row.localizationId)) return false;
      seen.add(row.localizationId);
      return true;
    });
  }

  /** Every row in a document's localization group, optionally minus one. */
  async listByLocalization(
    scope: Scope,
    localizationId: string,
    excludeId?: string,
  ): Promise<ContentRow[]> {
    const { contents } = this.t;
    const rows = await this.db
      .select()
      .from(contents)
      .where(and(this.inEnvironment(contents, scope), eq(contents.localizationId, localizationId)));
    const all = rows as unknown as ContentRow[];
    return excludeId ? all.filter((row) => row.id !== excludeId) : all;
  }

  /** Ids of the other rows in a localization group. */
  async listLocalizationSiblingIds(
    scope: Scope,
    localizationId: string,
    excludeId: string,
  ): Promise<string[]> {
    const { contents } = this.t;
    const rows = await this.db
      .select({ id: contents.id })
      .from(contents)
      .where(
        and(
          this.inEnvironment(contents, scope),
          eq(contents.localizationId, localizationId),
          ne(contents.id, excludeId),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** A draft row's type id. */
  async findTypeId(id: string): Promise<string | null> {
    const { contents } = this.t;
    const [row] = await this.db
      .select({ typeId: contents.typeId })
      .from(contents)
      .where(eq(contents.id, id))
      .limit(1);
    return row?.typeId ?? null;
  }

  /** Slugs of the first `limit` children of `parentId`, in `page` order. */
  async listSiblingSlugs(
    scope: Scope,
    locale: string,
    parentId: string | null,
    limit: number,
  ): Promise<string[]> {
    const { contents } = this.t;
    const rows = await this.db
      .select({ slug: contents.slug })
      .from(contents)
      .where(
        and(
          this.inEnvironment(contents, scope),
          eq(contents.locale, locale),
          parentId === null ? isNull(contents.parentId) : eq(contents.parentId, parentId),
        ),
      )
      .orderBy(asc(contents.position), asc(contents.createdAt))
      .limit(limit);
    return rows.map((row) => row.slug);
  }

  /** Which of these localization groups still hold a row. */
  async listExistingLocalizationIds(
    scope: Scope,
    localizationIds: readonly string[],
  ): Promise<Set<string>> {
    const unique = [...new Set(localizationIds)];
    const left = new Set<string>();
    const { contents } = this.t;
    for (const batch of batches(unique, 1, this.dialect.maxParameters - 2)) {
      const rows = await this.db
        .selectDistinct({ localizationId: contents.localizationId })
        .from(contents)
        .where(and(this.inEnvironment(contents, scope), inArray(contents.localizationId, batch)));
      for (const row of rows) left.add(row.localizationId);
    }
    return left;
  }

  async page(
    filter: ContentFilter,
    pagination: Pagination,
    sorts: ContentSort[] = [],
    published = false,
  ): Promise<Paginated<ContentRow>> {
    const table = this.table(published);
    const where = buildContentWhere(this.dialect, table, filter, this.registry);
    return paginate<ContentRow>(this.db, table, {
      where,
      orderBy: buildOrderBy(sorts),
      pagination,
      columns: this.readColumns(table),
    });
  }

  /**
   * Every matching document in batches of `batch`, in the order of `sorts` (not-null columns;
   * `position, created_at` by default, `id` last), for walks over a whole space: exports,
   * sitemaps. No OFFSET and no count, see `keysetBatches`.
   */
  batches(
    filter: ContentFilter,
    options: { sorts?: ContentSort[]; published?: boolean; batch?: number } = {},
  ): AsyncGenerator<ContentRow[]> {
    const table = this.table(options.published);
    return keysetBatches<ContentRow>(this.db, table, {
      where: buildContentWhere(this.dialect, table, filter, this.registry),
      order: keysetOrder(table, options.sorts ?? []),
      batch: options.batch ?? WALK_BATCH,
      columns: this.readColumns(table),
    });
  }

  /** Document counts per type, locale and status. */
  async countSummary(
    scope: Scope,
  ): Promise<Array<{ typeId: string; locale: string; status: ContentStatus; count: number }>> {
    const { contents } = this.t;
    const rows = await this.db
      .select({
        typeId: contents.typeId,
        locale: contents.locale,
        status: contents.status,
        count: count(),
      })
      .from(contents)
      .where(this.inEnvironment(contents, scope))
      .groupBy(contents.typeId, contents.locale, contents.status);
    return rows;
  }

  /**
   * Names of the given fields whose value another document of the type holds, in the draft
   * or the live table. Shared fields compare across locales, localized ones within `locale`.
   */
  async listTakenFields(
    scope: {
      spaceId: string;
      environmentId?: string | undefined;
      typeId: string;
      locale: string;
      localizationId: string | null;
    },
    fields: { name: string; value: unknown; localized: boolean }[],
    published = false,
  ): Promise<string[]> {
    if (fields.length === 0) return [];
    const d = this.dialect;
    const table = sql.identifier(published ? 'published_contents' : 'contents');
    const others = scope.localizationId
      ? sql`and localization_id <> ${d.param(scope.localizationId, 'uuid')}`
      : sql``;
    const probes = fields.map(
      (field, index) => sql`select name from (
        select ${d.param(field.name, 'text')} as name from ${table}
        where space_id = ${d.param(scope.spaceId, 'uuid')}
          and environment_id = ${this.environmentParam(scope)}
          and type_id = ${d.param(scope.typeId, 'uuid')}
          ${others}
          ${field.localized ? sql`and locale = ${scope.locale}` : sql``}
          and ${d.jsonFieldEquals(sql`fields`, field.name, field.value)}
        limit 1
      ) as ${sql.identifier(`probe${index}`)}`,
    );
    const rows = await d.rows<{ name: string }>(this.db, sql.join(probes, sql` union all `));
    return rows.map((row) => row.name);
  }
}
