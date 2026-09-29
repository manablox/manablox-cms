import type { RedirectSource, Scope } from '@manablox/core';
import { scopeSpaceId } from '@manablox/core';
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { batches } from '../batch.js';
import { escapeLike } from '../dialect.js';
import { keysetBatches, type Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { RedirectRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface RedirectWriteData {
  locale: string | null;
  fromPath: string;
  toPath: string | null;
  toContentId: string | null;
  status: number;
}

export interface RedirectFilter {
  search?: string | undefined;
  source?: RedirectSource | undefined;
  /** The locale's redirects plus the shared ones. */
  locale?: string | undefined;
}

/** A document title in one locale, for redirect targets. */
export interface RedirectTargetTitle {
  localizationId: string;
  locale: string;
  title: string;
}

/** One automatic redirect: an old permalink of a document. */
export interface AutoRedirect {
  locale: string;
  fromPath: string;
  toContentId: string;
}

/** Redirects of a space. Paths are normalised by the caller. */
export class RedirectRepository extends Repository {
  page(
    scope: Scope,
    filter: RedirectFilter,
    pagination: Pagination,
  ): Promise<Paginated<RedirectRow>> {
    const { redirects: r } = this.t;
    const conditions: Array<SQL | undefined> = [this.inEnvironment(r, scope)];
    if (filter.source) conditions.push(eq(r.source, filter.source));
    if (filter.locale) conditions.push(or(eq(r.locale, filter.locale), isNull(r.locale)));
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        or(this.dialect.ilike(r.fromPath, pattern), this.dialect.ilike(r.toPath, pattern)),
      );
    }
    return this.paginate(r, and(...conditions), [asc(r.fromPath), asc(r.id)], pagination);
  }

  /** Every redirect of the environment in batches, in `page`'s order, by keyset. */
  batches(scope: Scope, batch = 1000): AsyncGenerator<RedirectRow[]> {
    const { redirects: r } = this.t;
    return keysetBatches<RedirectRow>(this.db, r, {
      where: this.inEnvironment(r, scope),
      order: [{ column: r.fromPath }],
      batch,
    });
  }

  /** Draft titles of the documents behind `localizationIds`, one per locale. */
  async targetTitles(scope: Scope, localizationIds: string[]): Promise<RedirectTargetTitle[]> {
    const { contents: c } = this.t;
    const out: RedirectTargetTitle[] = [];
    for (const batch of batches([...new Set(localizationIds)], 1, this.dialect.maxParameters - 3)) {
      const rows = await this.db
        .select({ localizationId: c.localizationId, locale: c.locale, title: c.title })
        .from(c)
        .where(and(this.inEnvironment(c, scope), inArray(c.localizationId, batch)));
      out.push(...rows);
    }
    return out;
  }

  /** Every redirect in `locale`, the locale's own before a shared one of the same path. */
  async inLocale(scope: Scope, locale: string): Promise<RedirectRow[]> {
    const { redirects: r } = this.t;
    const rows = await this.db
      .select()
      .from(r)
      .where(and(this.inEnvironment(r, scope), or(eq(r.locale, locale), isNull(r.locale))))
      .orderBy(asc(r.fromPath), asc(r.id));
    const byPath = new Map<string, RedirectRow>();
    for (const row of rows) {
      if (row.locale !== null || !byPath.has(row.fromPath)) byPath.set(row.fromPath, row);
    }
    return [...byPath.values()];
  }

  /** The ids of the documents behind `localizationIds` in `locale`, by localization id. */
  async targetIds(
    scope: Scope,
    locale: string,
    localizationIds: string[],
  ): Promise<Map<string, string>> {
    const { contents: c } = this.t;
    const out = new Map<string, string>();
    for (const batch of batches([...new Set(localizationIds)], 1, this.dialect.maxParameters - 4)) {
      const rows = await this.db
        .select({ id: c.id, localizationId: c.localizationId })
        .from(c)
        .where(
          and(this.inEnvironment(c, scope), eq(c.locale, locale), inArray(c.localizationId, batch)),
        );
      for (const row of rows) out.set(row.localizationId, row.id);
    }
    return out;
  }

  findById(id: string, scope: Scope): Promise<RedirectRow | null> {
    const { redirects: r } = this.t;
    return this.findOneWhere(r, and(eq(r.id, id), this.inEnvironment(r, scope)));
  }

  /** The redirect of `fromPath` in `locale` exactly (`null`: the one for every locale). */
  findByPath(scope: Scope, locale: string | null, fromPath: string): Promise<RedirectRow | null> {
    const { redirects: r } = this.t;
    return this.findOneWhere(
      r,
      and(this.inEnvironment(r, scope), this.sameLocale(locale), eq(r.fromPath, fromPath)),
    );
  }

  /** The redirect of `path` in `locale`: the locale's own before a shared one. */
  async lookup(scope: Scope, locale: string, path: string): Promise<RedirectRow | null> {
    const { redirects: r } = this.t;
    const rows = await this.db
      .select()
      .from(r)
      .where(
        and(
          this.inEnvironment(r, scope),
          eq(r.fromPath, path),
          or(eq(r.locale, locale), isNull(r.locale)),
        ),
      )
      .limit(2);
    return rows.find((row) => row.locale === locale) ?? rows[0] ?? null;
  }

  async create(
    scope: Scope,
    data: RedirectWriteData & { source?: RedirectSource; actorId?: string | null },
  ): Promise<RedirectRow> {
    const { redirects: r } = this.t;
    const { actorId, ...values } = data;
    const [row] = await this.db
      .insert(r)
      .values({
        spaceId: scopeSpaceId(scope),
        environmentId: this.environmentOf(scope),
        ...values,
        createdBy: actorId ?? null,
      })
      .returning();
    return row as RedirectRow;
  }

  async update(
    id: string,
    scope: Scope,
    data: Partial<RedirectWriteData>,
  ): Promise<RedirectRow | null> {
    const { redirects: r } = this.t;
    const [row] = await this.db
      .update(r)
      .set({ ...data, source: 'manual', updatedAt: new Date() })
      .where(and(eq(r.id, id), this.inEnvironment(r, scope)))
      .returning();
    return row ?? null;
  }

  delete(id: string, scope: Scope): Promise<boolean> {
    const { redirects: r } = this.t;
    return this.removeWhere(r, and(eq(r.id, id), this.inEnvironment(r, scope)));
  }

  /** Removes the locale's redirects of paths that are live permalinks now. */
  async deleteLivePaths(scope: Scope, locale: string, paths: string[]): Promise<number> {
    const { redirects: r } = this.t;
    let removed = 0;
    for (const batch of batches([...new Set(paths)], 1, this.dialect.maxParameters - 4)) {
      const rows = await this.db
        .delete(r)
        .where(and(this.inEnvironment(r, scope), eq(r.locale, locale), inArray(r.fromPath, batch)))
        .returning({ id: r.id });
      removed += rows.length;
    }
    return removed;
  }

  /**
   * Points old permalinks at their documents, replacing a redirect of the same path, and
   * retargets redirects to those paths at the documents, so no redirect leads to another.
   */
  async upsertAuto(scope: Scope, entries: AutoRedirect[]): Promise<void> {
    const { redirects: r } = this.t;
    for (const entry of entries) {
      await this.db
        .delete(r)
        .where(
          and(
            this.inEnvironment(r, scope),
            eq(r.locale, entry.locale),
            eq(r.fromPath, entry.fromPath),
          ),
        );
      await this.db.insert(r).values({
        spaceId: scopeSpaceId(scope),
        environmentId: this.environmentOf(scope),
        locale: entry.locale,
        fromPath: entry.fromPath,
        toContentId: entry.toContentId,
        toPath: null,
        status: 301,
        source: 'auto',
      });
      await this.retargetPath(scope, entry.locale, entry.fromPath, {
        toPath: null,
        toContentId: entry.toContentId,
      });
    }
  }

  /**
   * Points redirects to `path` at `target` instead. A locale's path takes that locale's
   * redirects along, plus shared ones when the target is a document; a shared path takes all.
   */
  async retargetPath(
    scope: Scope,
    locale: string | null,
    path: string,
    target: Pick<RedirectWriteData, 'toPath' | 'toContentId'>,
  ): Promise<void> {
    const { redirects: r } = this.t;
    const locales =
      locale === null
        ? undefined
        : target.toContentId
          ? or(eq(r.locale, locale), isNull(r.locale))
          : eq(r.locale, locale);
    await this.db
      .update(r)
      .set({ toPath: target.toPath, toContentId: target.toContentId, updatedAt: new Date() })
      .where(and(this.inEnvironment(r, scope), eq(r.toPath, path), locales));
  }

  private sameLocale(locale: string | null): SQL {
    const { redirects: r } = this.t;
    return locale === null ? isNull(r.locale) : eq(r.locale, locale);
  }
}
