import {
  auditor,
  diffRecords,
  ManabloxError,
  purgeTags,
  REDIRECT_STATUSES,
  type RedirectSource,
  redirectsCacheTag,
  type Scope,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type Paginated,
  type Pagination,
  type PublishedPermalink,
  type RedirectRow,
  type RedirectWriteData,
  type Repositories,
  uniqueViolation,
  whenCommitted,
} from '@manablox/db';
import { hookScope, requireInSpace } from './lib.js';

export type { RedirectRow };

/** A listed redirect; `toTitle` names a document target, `null` when it is gone. */
export type RedirectListRow = RedirectRow & { toTitle: string | null };

/** Redirects one lookup follows before it calls the chain a loop. */
const MAX_HOPS = 10;

/**
 * A path as stored: leading slash, no trailing slash, no repeated slashes, no query or
 * fragment; `null` when it is not a path.
 */
export function normaliseRedirectPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || /[?#\s]/.test(trimmed)) return null;
  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

/** A redirect target on another origin. */
const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** A permalink as a path. */
export const permalinkPath = (permalink: string): string => `/${permalink}`;

export interface RedirectInput {
  locale?: string | null | undefined;
  fromPath: string;
  /** A path or an absolute `http(s)` URL. */
  toPath?: string | null | undefined;
  /** A document's `localizationId`. */
  toContentId?: string | null | undefined;
  status?: number | undefined;
}

type RedirectTarget = Pick<RedirectWriteData, 'toPath' | 'toContentId'>;

const fromPathConflict = uniqueViolation({
  constraint: 'redirects_environment_locale_from',
  key: 'redirect.fromPath.taken',
  path: ['fromPath'],
  errorKey: 'redirect.validation.failed',
});

const invalid = (
  key:
    | 'redirect.path.invalid'
    | 'redirect.target.required'
    | 'redirect.target.self'
    | 'redirect.target.loop'
    | 'redirect.locale.unknown'
    | 'redirect.fromPath.taken',
  path: string,
  params: Record<string, unknown> = {},
) => ManabloxError.validation([{ key, path: [path], params }], 'redirect.validation.failed');

/**
 * Old paths of a space: manual redirects, and automatic 301s a publish records when a
 * document's live permalink changes.
 */
export class RedirectService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = auditor(repos, 'redirect', (row: RedirectRow) => row.fromPath, {
      meta: (row) => ({ locale: row.locale, source: row.source }),
    });
  }

  using(repos: Repositories): RedirectService {
    return new RedirectService(this.manablox, repos);
  }

  /**
   * A page of redirects; `locale` keeps that locale's and the shared ones. Document targets
   * carry the title in the redirect's locale (shared ones: the default locale's), else any.
   */
  async list(
    scope: Scope,
    filter: {
      search?: string | undefined;
      source?: RedirectSource | undefined;
      locale?: string | undefined;
    },
    pagination: Pagination,
  ): Promise<Paginated<RedirectListRow>> {
    const spaceId = scopeSpaceId(scope);
    const page = await this.repos.redirects.page(scope, filter, pagination);
    const ids = page.items.flatMap((row) => (row.toContentId ? [row.toContentId] : []));
    if (!ids.length)
      return { ...page, items: page.items.map((row) => ({ ...row, toTitle: null })) };
    const [space, titles] = await Promise.all([
      this.repos.spaces.findById(spaceId),
      this.repos.redirects.targetTitles(scope, ids),
    ]);
    const byGroup = new Map<string, Map<string, string>>();
    for (const entry of titles) {
      const group = byGroup.get(entry.localizationId) ?? new Map<string, string>();
      group.set(entry.locale, entry.title);
      byGroup.set(entry.localizationId, group);
    }
    return {
      ...page,
      items: page.items.map((row) => {
        const group = row.toContentId ? byGroup.get(row.toContentId) : undefined;
        const locale = row.locale ?? space?.defaultLocale ?? '';
        const toTitle = group ? (group.get(locale) ?? [...group.values()][0] ?? null) : null;
        return { ...row, toTitle };
      }),
    };
  }

  async get(scope: Scope, id: string): Promise<RedirectRow> {
    return this.find(scope, id);
  }

  /** The redirect `path` answers with in `locale`, or `null`. */
  lookup(scope: Scope, locale: string, path: string): Promise<RedirectRow | null> {
    const normalised = normaliseRedirectPath(path);
    if (!normalised) return Promise.resolve(null);
    return this.repos.redirects.lookup(scope, locale, normalised);
  }

  async create(
    scope: Scope,
    input: RedirectInput,
    actorId: string | null = null,
  ): Promise<RedirectRow> {
    const spaceId = scopeSpaceId(scope);
    const data = await this.prepare(scope, input);
    if (await this.repos.redirects.findByPath(scope, data.locale, data.fromPath)) {
      throw invalid('redirect.fromPath.taken', 'fromPath', { fromPath: data.fromPath });
    }
    await this.manablox.hooks.run(
      'redirect:beforeCreate',
      { spaceId, locale: data.locale, fromPath: data.fromPath, source: 'manual' },
      { manablox: this.manablox, ...hookScope(scope) },
    );
    await this.manablox.controls.assertLimit(scope, 'redirectsPerSpace');
    return this.repos.transaction(async (tx) => {
      const row = await tx.redirects
        .create(scope, { ...data, source: 'manual', actorId })
        .catch(fromPathConflict({ fromPath: data.fromPath }));
      await tx.redirects.retargetPath(scope, data.locale, data.fromPath, data);
      await this.audit.in(tx).record('redirect.create', row, snapshotChanges(row, 'created'));
      await this.purge(tx, scope);
      return row;
    });
  }

  /** Saving an automatic redirect makes it manual. */
  async update(scope: Scope, id: string, input: RedirectInput): Promise<RedirectRow> {
    const before = await this.find(scope, id);
    const data = await this.prepare(scope, input);
    const taken = await this.repos.redirects.findByPath(scope, data.locale, data.fromPath);
    if (taken && taken.id !== id) {
      throw invalid('redirect.fromPath.taken', 'fromPath', { fromPath: data.fromPath });
    }
    if (before.source !== 'manual') {
      await this.manablox.controls.assertLimit(scope, 'redirectsPerSpace');
    }
    return this.repos.transaction(async (tx) => {
      const row = await tx.redirects
        .update(id, scope, data)
        .catch(fromPathConflict({ fromPath: data.fromPath }));
      if (!row) throw ManabloxError.notFound('redirect.notFound', { id });
      await tx.redirects.retargetPath(scope, data.locale, data.fromPath, data);
      await this.audit.in(tx).record('redirect.update', row, diffRecords(before, row));
      await this.purge(tx, scope);
      return row;
    });
  }

  async delete(scope: Scope, id: string): Promise<void> {
    const row = await this.find(scope, id);
    await this.repos.transaction(async (tx) => {
      await tx.redirects.delete(id, scope);
      await this.audit.in(tx).record('redirect.delete', row, snapshotChanges(row, 'deleted'));
      await this.purge(tx, scope);
    });
  }

  // -------------------------------------------------------------------------

  /** Validates an input and flattens its target through existing redirects. */
  private async prepare(scope: Scope, input: RedirectInput): Promise<RedirectWriteData> {
    const spaceId = scopeSpaceId(scope);
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });

    const locale = input.locale ?? null;
    if (locale !== null && !space.locales.includes(locale)) {
      throw invalid('redirect.locale.unknown', 'locale', { locale });
    }
    const fromPath = normaliseRedirectPath(input.fromPath);
    if (!fromPath) throw invalid('redirect.path.invalid', 'fromPath', { path: input.fromPath });

    const status = input.status ?? 301;
    if (!(REDIRECT_STATUSES as readonly number[]).includes(status)) {
      throw ManabloxError.validation(
        [{ key: 'validation.invalid', path: ['status'], params: { status } }],
        'redirect.validation.failed',
      );
    }

    const toContentId = input.toContentId ?? null;
    let toPath: string | null = null;
    if (input.toPath) {
      toPath = isAbsoluteUrl(input.toPath)
        ? input.toPath.trim()
        : normaliseRedirectPath(input.toPath);
      if (!toPath || (isAbsoluteUrl(toPath) && !URL.canParse(toPath))) {
        throw invalid('redirect.path.invalid', 'toPath', { path: input.toPath });
      }
    }
    if ((toPath === null) === (toContentId === null)) {
      throw invalid('redirect.target.required', 'toPath');
    }
    if (toContentId) {
      const [document] = await this.repos.content.listByLocalizationIds(scope, [toContentId]);
      if (!document) throw ManabloxError.badRequest('content.notInSpace', { id: toContentId });
    }

    const target = await this.flatten(scope, locale, fromPath, { toPath, toContentId });
    return { locale, fromPath, status, ...target };
  }

  /** Follows a path target through the redirects it hits, so the stored one needs no second hop. */
  private async flatten(
    scope: Scope,
    locale: string | null,
    fromPath: string,
    target: RedirectTarget,
  ): Promise<RedirectTarget> {
    let current = target;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (!current.toPath || isAbsoluteUrl(current.toPath)) return current;
      if (current.toPath === fromPath) {
        throw invalid(hop === 0 ? 'redirect.target.self' : 'redirect.target.loop', 'toPath', {
          path: current.toPath,
        });
      }
      const next = locale
        ? await this.repos.redirects.lookup(scope, locale, current.toPath)
        : await this.repos.redirects.findByPath(scope, null, current.toPath);
      if (!next) return current;
      current = { toPath: next.toPath, toContentId: next.toContentId };
    }
    throw invalid('redirect.target.loop', 'toPath', { path: target.toPath });
  }

  private async find(scope: Scope, id: string): Promise<RedirectRow> {
    return requireInSpace(
      await this.repos.redirects.findById(id, scope),
      scope,
      'redirect.notFound',
      { id },
    );
  }

  private purge(repos: Repositories, scope: Scope): Promise<void> {
    const spaceId = scopeSpaceId(scope);
    return whenCommitted(repos, () =>
      purgeTags(this.manablox, spaceId, [redirectsCacheTag(spaceId)]),
    );
  }
}

/**
 * Records the permalink changes of one publish: a 301 from each old live permalink to its
 * document, and no redirect left on a path that is live now. Runs on the publish's
 * repositories; returns whether a redirect changed. A redirect `redirect:beforeCreate`
 * refuses is skipped and logged; the publish goes on.
 */
export async function recordPermalinkChanges(
  manablox: Manablox,
  repos: Repositories,
  scope: Scope,
  before: readonly PublishedPermalink[],
  after: readonly PublishedPermalink[],
): Promise<boolean> {
  const previous = new Map(before.map((row) => [row.id, row.permalink]));
  const found = after.flatMap((row) => {
    const old = previous.get(row.id);
    return old && old !== row.permalink
      ? [{ locale: row.locale, fromPath: permalinkPath(old), toContentId: row.localizationId }]
      : [];
  });
  const moved = await allowedRedirects(manablox, scope, found);
  const liveByLocale = new Map<string, string[]>();
  for (const row of after) {
    if (!row.permalink || previous.get(row.id) === row.permalink) continue;
    liveByLocale.set(row.locale, [
      ...(liveByLocale.get(row.locale) ?? []),
      permalinkPath(row.permalink),
    ]);
  }
  if (moved.length === 0 && liveByLocale.size === 0) return false;

  await repos.redirects.upsertAuto(scope, moved);
  let removed = 0;
  for (const [locale, paths] of liveByLocale) {
    removed += await repos.redirects.deleteLivePaths(scope, locale, paths);
  }
  return moved.length > 0 || removed > 0;
}

/** The automatic redirects `redirect:beforeCreate` lets through. */
async function allowedRedirects<T extends { locale: string; fromPath: string }>(
  manablox: Manablox,
  scope: Scope,
  redirects: T[],
): Promise<T[]> {
  if (!redirects.length || !manablox.hooks.has('redirect:beforeCreate')) return redirects;
  const spaceId = scopeSpaceId(scope);
  const allowed: T[] = [];
  for (const redirect of redirects) {
    try {
      await manablox.hooks.run(
        'redirect:beforeCreate',
        { spaceId, locale: redirect.locale, fromPath: redirect.fromPath, source: 'auto' },
        { manablox, ...hookScope(scope) },
      );
      allowed.push(redirect);
    } catch (error) {
      manablox.logger.warn(
        { err: error, spaceId, fromPath: redirect.fromPath },
        'automatic redirect refused',
      );
    }
  }
  return allowed;
}
