import {
  type TouchedIds,
  trackAsset,
  trackAssetList,
  trackListTypes,
  trackTag,
  trackTouched,
} from '@manablox/cache';
import {
  type ContentListRequest,
  isSpaceReady,
  ManabloxError,
  type ResolvedScope,
  redirectsCacheTag,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, ContentRow, Paginated, Repositories } from '@manablox/db';
import DataLoader from 'dataloader';
import { applyReadPermissions, readRestrictedFields } from '../content/permissions.js';
import { hasReadHooks, runBeforeList, runReadHooks } from '../content/read-hooks.js';
import { defaultLocaleOf, type Loaders } from '../loaders.js';
import type { MenuService, PublicMenu, PublicMenuItem } from '../menu.service.js';
import { type PublicListArgs, toPublicListQuery } from '../public-query.js';
import { contentRelationQuery, type RelationQuerySettings } from '../relation-query.js';

export interface DeliveryReaderOptions {
  manablox: Manablox;
  repos: Repositories;
  loaders: Loaders;
  menus?: MenuService | undefined;
  /** The space relation queries run in; `null` answers them empty. */
  spaceId: string | null;
  /** The request's environment; reads in its space use it, others production. */
  scope?: ResolvedScope | null | undefined;
  /** Reads the published projection; `false` is preview. */
  published: boolean;
  /** Present only where a response cache is mounted. */
  touched?: TouchedIds | undefined;
}

/** A redirect as delivered in one locale. */
export interface PublicRedirect {
  /** `null`: it applies to every locale. */
  locale: string | null;
  /** Leading slash, no locale prefix. */
  fromPath: string;
  /** A path like `fromPath`, or an absolute `http(s)` URL. */
  toPath: string;
  status: number;
  /** The target document's id; `null` for a path target. */
  contentId: string | null;
}

export type DeliveryRelation =
  | { target: 'asset'; items: AssetRow[] }
  | { target: 'content'; items: ContentRow[] };

/**
 * Per-request reads for the delivery surfaces: batched by the loaders, passed through the
 * read hooks and anonymous read permissions, and tracked for cache tags. A space whose
 * import has not finished reads as missing.
 */
export class DeliveryReader {
  readonly spaceId: string | null;
  readonly scope: ResolvedScope | null;
  readonly published: boolean;
  readonly touched: TouchedIds | undefined;
  private readonly manablox: Manablox;
  private readonly repos: Repositories;
  private readonly loaders: Loaders;
  private readonly menus: MenuService | undefined;
  private readonly raw: Loaders['content'];
  private readonly contentById: DataLoader<string, ContentRow | null>;
  private readonly childrenOf = new Map<string, Promise<ContentRow[]>>();
  private readonly relations = new Map<string, Promise<DeliveryRelation>>();

  constructor(options: DeliveryReaderOptions) {
    this.manablox = options.manablox;
    this.repos = options.repos;
    this.loaders = options.loaders;
    this.menus = options.menus;
    this.spaceId = options.spaceId;
    this.scope = options.scope ?? null;
    this.published = options.published;
    this.touched = options.touched;

    this.raw = this.published ? this.loaders.publishedContent : this.loaders.content;
    this.contentById = new DataLoader(async (ids) => {
      const found = (await this.raw.loadMany([...ids])).filter(
        (row): row is ContentRow => row !== null && !(row instanceof Error),
      );
      const byId = new Map((await this.read(found)).map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id) ?? null);
    });
  }

  defaultLocale(spaceId: string): Promise<string> {
    return defaultLocaleOf(this.loaders, spaceId);
  }

  /** The environment id hooks see for reads in `spaceId`. */
  private environmentOf(spaceId: string): string | undefined {
    return this.scopeFor(spaceId)?.environmentId;
  }

  /** The request's environment when `spaceId` is its space, else the space's production. */
  scopeFor(spaceId: string): ResolvedScope | null {
    return this.scope?.spaceId === spaceId ? this.scope : null;
  }

  /** A page of published documents for public list arguments. */
  async list(spaceId: string, args: PublicListArgs): Promise<Paginated<ContentRow>> {
    await this.assertReady(spaceId);
    const locale = args.locale ?? (await this.defaultLocale(spaceId));
    const query = toPublicListQuery(this.manablox.contentTypes, args, {
      spaceId,
      scope: this.scopeFor(spaceId),
      locale,
    });
    const allowed = await this.beforeList(spaceId, {
      kind: 'list',
      typeIds: [...(query.typeIds ?? [])],
      locale,
    });
    if (!allowed) {
      return {
        items: [],
        total: 0,
        limit: query.pagination.limit,
        offset: query.pagination.offset,
      };
    }
    const page = await this.repos.content.page(
      query.filter,
      query.pagination,
      query.sorts,
      this.published,
    );
    trackTouched(this.touched, page.items);
    trackListTypes(this.touched, query.typeIds);
    return { ...page, items: await this.read(page.items, spaceId, true) };
  }

  /** A document asked for by id at the top level; `content:beforeRead` may refuse it. */
  async get(id: string): Promise<ContentRow | null> {
    if (this.manablox.hooks.has('content:beforeRead')) {
      const spaceId = this.spaceId || (await this.raw.load(id))?.spaceId;
      if (!spaceId) return null;
      await this.beforeRead(id, spaceId);
    }
    return this.byId(id);
  }

  async byId(id: string): Promise<ContentRow | null> {
    const row = await this.contentById.load(id);
    if (row) trackTouched(this.touched, [row]);
    return row;
  }

  /** Found documents by id; missing and hidden ones are absent. */
  async byIds(ids: Iterable<string>): Promise<Map<string, ContentRow>> {
    const wanted = [...new Set(ids)];
    const out = new Map<string, ContentRow>();
    if (wanted.length === 0) return out;
    for (const row of await this.contentById.loadMany(wanted)) {
      if (row && !(row instanceof Error)) out.set(row.id, row);
    }
    trackTouched(this.touched, out.values());
    return out;
  }

  /** Resolves a URL path; a miss and the home page are filed under the space. */
  async byPermalink(
    spaceId: string,
    path: string,
    locale?: string | null,
  ): Promise<ContentRow | null> {
    await this.assertReady(spaceId);
    const permalink = path.replace(/^\/+|\/+$/g, '');
    const found = await this.repos.content.findByPermalink(
      this.scopeFor(spaceId) ?? spaceId,
      locale ?? (await this.defaultLocale(spaceId)),
      permalink,
      this.published,
    );
    if (found) trackTouched(this.touched, [found]);
    // A later publish may fill a miss; the home nomination lives on the space.
    if ((!found || permalink === '') && this.touched) this.touched.spaceWide = true;
    if (!found) return null;
    if (this.manablox.hooks.has('content:beforeRead')) {
      await this.beforeRead(found.id, spaceId, { permalink });
    }
    const [row] = await this.read([found], spaceId);
    return row ?? null;
  }

  async children(parentId: string): Promise<ContentRow[]> {
    let pending = this.childrenOf.get(parentId);
    if (!pending) {
      pending = this.loadChildren(parentId);
      this.childrenOf.set(parentId, pending);
    }
    const rows = await pending;
    trackTouched(this.touched, rows);
    return rows;
  }

  /** A `filter` relation's rows, once per field per request. Users are never listed. */
  async relation(
    fieldId: string,
    target: 'content' | 'asset' | 'user',
    settings: RelationQuerySettings,
  ): Promise<DeliveryRelation> {
    const spaceId = this.spaceId;
    if (!spaceId || target === 'user') return { target: 'content', items: [] };

    const key = `${target}:${fieldId}`;
    let pending = this.relations.get(key);
    if (!pending) {
      pending = this.relationRows(fieldId, target, settings, spaceId);
      this.relations.set(key, pending);
    }
    return pending;
  }

  private async relationRows(
    fieldId: string,
    target: 'content' | 'asset',
    settings: RelationQuerySettings,
    spaceId: string,
  ): Promise<DeliveryRelation> {
    if (!(await this.isReady(spaceId))) return { target, items: [] };
    if (target === 'content') {
      const { typeIds = [] } = contentRelationQuery(settings, { spaceId, locale: '' });
      const request: ContentListRequest = {
        kind: 'relation',
        typeIds: [...typeIds],
        locale: null,
        fieldId,
      };
      if (!(await this.beforeList(spaceId, request))) return { target, items: [] };
    }
    const environmentId = this.scopeFor(spaceId)?.environmentId;
    return this.loaders.relationQuery
      .load({ fieldId, target, settings, spaceId, ...(environmentId ? { environmentId } : {}) })
      .then(async (result) => {
        if (result.target === 'asset') {
          trackAssetList(this.touched);
          for (const asset of result.items) trackAsset(this.touched, asset.id);
          return result;
        }
        trackTouched(this.touched, result.items);
        trackListTypes(this.touched, result.typeIds);
        return { target: 'content', items: await this.read(result.items, spaceId) };
      });
  }

  async asset(id: string): Promise<AssetRow | null> {
    const row = await this.loaders.asset.load(id);
    if (row) trackAsset(this.touched, row.id);
    return row;
  }

  /** Found assets by id, in one batch. */
  async assets(ids: Iterable<string>): Promise<Map<string, AssetRow>> {
    const wanted = [...new Set(ids)];
    const out = new Map<string, AssetRow>();
    if (wanted.length === 0) return out;
    for (const row of await this.loaders.asset.loadMany(wanted)) {
      if (row && !(row instanceof Error)) {
        out.set(row.id, row);
        trackAsset(this.touched, row.id);
      }
    }
    return out;
  }

  /** A named menu; an entry whose document a hook hides drops out with its children. */
  async menu(spaceId: string, name: string, locale?: string | null): Promise<PublicMenu | null> {
    if (!this.menus) return null;
    await this.assertReady(spaceId);
    // Any publish or menu edit in the space can change a menu.
    if (this.touched) this.touched.spaceWide = true;
    const menuLocale = locale ?? (await this.defaultLocale(spaceId));
    const request: ContentListRequest = {
      kind: 'menu',
      typeIds: [],
      locale: menuLocale,
      menu: name,
    };
    if (!(await this.beforeList(spaceId, request))) return null;
    const menu = await this.menus.resolve(
      this.scopeFor(spaceId) ?? spaceId,
      name,
      menuLocale,
      this.published,
    );
    if (!menu) return null;

    const rows = collectMenuRows(menu.items);
    trackTouched(this.touched, rows);
    const byId = new Map((await this.read(rows, spaceId)).map((row) => [row.id, row]));
    return { ...menu, items: rebuildMenu(menu.items, byId) };
  }

  /**
   * The redirects of `locale`, its own before shared ones. A document target resolves to its
   * permalink in that locale; one the reader cannot see drops out.
   */
  async redirects(spaceId: string, locale?: string | null): Promise<PublicRedirect[]> {
    await this.assertReady(spaceId);
    // A publish can move or hide a target.
    if (this.touched) this.touched.spaceWide = true;
    trackTag(this.touched, redirectsCacheTag(spaceId));
    const inLocale = locale ?? (await this.defaultLocale(spaceId));
    const scope = this.scopeFor(spaceId) ?? spaceId;
    const rows = await this.repos.redirects.inLocale(scope, inLocale);
    const groups = rows.flatMap((row) => (row.toPath || !row.toContentId ? [] : [row.toContentId]));
    const ids = groups.length
      ? await this.repos.redirects.targetIds(scope, inLocale, groups)
      : new Map<string, string>();
    const documents = await this.byIds(ids.values());
    return rows.flatMap((row): PublicRedirect[] => {
      const base = { locale: row.locale, fromPath: row.fromPath, status: row.status };
      if (row.toPath) return [{ ...base, toPath: row.toPath, contentId: null }];
      const id = row.toContentId ? ids.get(row.toContentId) : undefined;
      const document = id ? documents.get(id) : undefined;
      if (!document || document.permalink === null) return [];
      return [{ ...base, toPath: `/${document.permalink}`, contentId: document.id }];
    });
  }

  private async loadChildren(parentId: string): Promise<ContentRow[]> {
    if (this.manablox.hooks.has('content:beforeList')) {
      const spaceId = this.spaceId || (await this.raw.load(parentId))?.spaceId;
      if (!spaceId) return [];
      const request: ContentListRequest = { kind: 'children', typeIds: [], locale: null, parentId };
      if (!(await this.beforeList(spaceId, request))) return [];
    }
    return this.read(await this.loaders.children.load(parentId));
  }

  /** Whether the space's import, if any, finished; an unknown space counts as ready. */
  private async isReady(spaceId: string): Promise<boolean> {
    const space = await this.loaders.space.load(spaceId);
    return !space || isSpaceReady(space);
  }

  private async assertReady(spaceId: string): Promise<void> {
    if (!(await this.isReady(spaceId))) {
      throw ManabloxError.notFound('space.notFound', { spaceId });
    }
  }

  /** `false` when a hook refused the list, unless it threw a `ManabloxError`. */
  /** Rows found by a list read of the caller's own, through the list hooks like `list`. */
  async listed(
    spaceId: string,
    request: ContentListRequest,
    rows: ContentRow[],
  ): Promise<ContentRow[]> {
    if (!(await this.beforeList(spaceId, request))) return [];
    return this.read(rows, spaceId, true);
  }

  private async beforeList(spaceId: string, request: ContentListRequest): Promise<boolean> {
    try {
      await runBeforeList(this.manablox, request, {
        actor: null,
        spaceId,
        environmentId: this.environmentOf(spaceId),
        published: this.published,
      });
      return true;
    } catch (err) {
      if (err instanceof ManabloxError) throw err;
      return false;
    }
  }

  /** A refusal reads as a miss unless the handler threw a `ManabloxError`. */
  private async beforeRead(
    id: string,
    spaceId: string,
    miss: Record<string, string> = { id },
  ): Promise<void> {
    try {
      await this.manablox.hooks.run(
        'content:beforeRead',
        { id },
        {
          manablox: this.manablox,
          actor: null,
          spaceId,
          environmentId: this.environmentOf(spaceId),
          published: this.published,
        },
      );
    } catch (err) {
      if (err instanceof ManabloxError) throw err;
      throw ManabloxError.notFound('content.notFound', miss);
    }
  }

  /** Rows of ready spaces, through the read hooks, with the fields an anonymous reader may see. */
  private async read(
    loaded: ContentRow[],
    spaceId: string | null = this.spaceId,
    list = false,
  ): Promise<ContentRow[]> {
    if (loaded.length === 0) return loaded;
    const rows = await this.fromReadySpaces(loaded);
    if (rows.length === 0) return rows;
    const hooked = hasReadHooks(this.manablox, list)
      ? await runReadHooks(
          this.manablox,
          rows,
          {
            actor: null,
            spaceId,
            environmentId: spaceId ? this.environmentOf(spaceId) : undefined,
            published: this.published,
          },
          { list },
        )
      : rows;
    return hooked.some((row) => this.restricted(row))
      ? hooked.map((row) => this.permitted(row))
      : hooked;
  }

  private async fromReadySpaces(rows: ContentRow[]): Promise<ContentRow[]> {
    const spaceIds = [...new Set(rows.map((row) => row.spaceId))];
    const ready = await Promise.all(spaceIds.map((id) => this.isReady(id)));
    if (ready.every(Boolean)) return rows;
    const hidden = new Set(spaceIds.filter((_, index) => !ready[index]));
    return rows.filter((row) => !hidden.has(row.spaceId));
  }

  private restricted(row: ContentRow): boolean {
    const type = this.manablox.contentTypes.tryGet(row.typeId);
    return type ? readRestrictedFields(type).length > 0 : false;
  }

  private permitted(row: ContentRow): ContentRow {
    const type = this.manablox.contentTypes.tryGet(row.typeId);
    return type ? applyReadPermissions(row, type, null) : row;
  }
}

function collectMenuRows(items: PublicMenuItem[]): ContentRow[] {
  const out: ContentRow[] = [];
  for (const item of items) {
    if (item.content) out.push(item.content);
    out.push(...collectMenuRows(item.children));
  }
  return out;
}

function rebuildMenu(items: PublicMenuItem[], rows: Map<string, ContentRow>): PublicMenuItem[] {
  const out: PublicMenuItem[] = [];
  for (const item of items) {
    const content = item.content ? rows.get(item.content.id) : null;
    if (content === undefined) continue;
    out.push({ ...item, content, children: rebuildMenu(item.children, rows) });
  }
  return out;
}
