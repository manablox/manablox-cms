import { inScope, type Scope, scopeSpaceId } from '@manablox/core';
import {
  type ContentFilter,
  type ContentRow,
  type ContentSort,
  labelToId,
  type Paginated,
  type Pagination,
  type TreeChild,
  type TreeNode,
} from '@manablox/db';
import { retentionCutoff } from '../retention.js';
import type { ContentCore } from './core.js';
import { applyReadPermissions } from './permissions.js';
import { type ReadScope, runBeforeList, runReadHooks } from './read-hooks.js';
import type { Actor } from './types.js';

/** A search hit or one of its ancestors; `parentId` is the nearest node also in the result. */
export interface TreeSearchNode {
  content: ContentRow;
  parentId: string | null;
  match: boolean;
}

export interface TreeSearchResult {
  nodes: TreeSearchNode[];
  /** Matches in all, which may exceed those returned. */
  total: number;
}

/** The read hooks' scope of a request. */
function readScope(scope: Scope, actor: Actor | null, published: boolean): ReadScope {
  return {
    actor,
    spaceId: scopeSpaceId(scope),
    ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
    published,
  };
}

/** A row's ancestor ids, root first, from its path. */
function pathAncestors(row: ContentRow): string[] {
  return row.path.split('.').slice(0, -1).map(labelToId);
}

function flattenTree(nodes: TreeNode[]): ContentRow[] {
  return nodes.flatMap((node) => [node.content, ...flattenTree(node.children)]);
}

/** Puts hook results back on their nodes; a dropped row takes its subtree with it. */
function rebuildTree(nodes: TreeNode[], rows: Map<string, ContentRow>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const content = rows.get(node.content.id);
    if (!content) continue;
    out.push({ ...node, content, children: rebuildTree(node.children, rows) });
  }
  return out;
}

/** Drops documents of hidden types but keeps their children. */
function pruneHidden(nodes: TreeNode[], hidden: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const children = pruneHidden(node.children, hidden);
    if (hidden.has(node.content.typeId)) {
      out.push(...children);
      continue;
    }
    out.push({ ...node, children });
  }
  return out;
}

/** Document, list, tree and version reads with read hooks and permissions applied. */
export class ContentReads {
  constructor(private readonly core: ContentCore) {}

  async get(
    scope: Scope,
    id: string,
    options: { published?: boolean; actor?: Actor | null } = {},
  ): Promise<ContentRow | null> {
    const { manablox, repos, registry } = this.core;
    const published = options.published ?? false;
    const actor = options.actor ?? null;
    const { hooks } = manablox;
    const read = readScope(scope, actor, published);
    if (hooks.has('content:beforeRead')) {
      await hooks.run(
        'content:beforeRead',
        { id },
        { manablox, ...read, spaceId: read.spaceId as string },
      );
    }
    const row = await repos.content.findById(id, published);
    if (!row || !inScope(row, scope)) return null;

    const [result] = await this.afterRead([row], read);
    return result ? applyReadPermissions(result, registry.get(result.typeId), actor) : null;
  }

  private afterRead(
    rows: ContentRow[],
    scope: ReadScope,
    options: { list?: boolean } = {},
  ): Promise<ContentRow[]> {
    return runReadHooks(this.core.manablox, rows, scope, options);
  }

  async list(
    filter: ContentFilter,
    pagination: Pagination,
    sorts: ContentSort[],
    options: { published?: boolean; actor?: Actor | null },
  ) {
    const published = options.published ?? false;
    const actor = options.actor ?? null;
    const scope: ReadScope = {
      actor,
      spaceId: filter.spaceId ?? null,
      ...(filter.environmentId ? { environmentId: filter.environmentId } : {}),
      published,
    };
    if (filter.spaceId) {
      await runBeforeList(
        this.core.manablox,
        { kind: 'list', typeIds: [...(filter.typeIds ?? [])], locale: filter.locale ?? null },
        { ...scope, spaceId: filter.spaceId },
      );
    }
    const result = await this.core.repos.content.page(filter, pagination, sorts, published);
    const rows = await this.afterRead(result.items, scope, { list: true });
    const items = rows.map((row) =>
      applyReadPermissions(row, this.core.registry.get(row.typeId), actor),
    );
    return { ...result, items };
  }

  async tree(
    scope: Scope,
    locale: string,
    rootId: string | null,
    options: { published?: boolean; actor?: Actor | null; typeIds?: string[] | null },
  ): Promise<TreeNode[]> {
    const published = options.published ?? false;
    const actor = options.actor ?? null;
    const read = readScope(scope, actor, published);
    await runBeforeList(
      this.core.manablox,
      { kind: 'tree', typeIds: options.typeIds ?? [], locale, parentId: rootId },
      { ...read, spaceId: scopeSpaceId(scope) },
    );
    const nodes = await this.core.repos.content.listTree(scope, locale, rootId, 32, published);
    const rows = await this.afterRead(flattenTree(nodes), read);
    const byId = new Map(rows.map((row) => [row.id, this.core.readable(row, actor)]));
    const hidden = new Set(await this.core.hiddenTypeIds(scope, options.typeIds ?? null));
    return pruneHidden(rebuildTree(nodes, byId), hidden);
  }

  async treeChildren(
    scope: Scope,
    locale: string,
    parentId: string | null,
    options: {
      limit?: number;
      offset?: number;
      published?: boolean;
      actor?: Actor | null;
      typeIds?: string[] | null;
    },
  ): Promise<Paginated<TreeChild>> {
    const { actor = null, typeIds = null, ...page } = options;
    const published = page.published ?? false;
    const read = readScope(scope, actor, published);
    await runBeforeList(
      this.core.manablox,
      { kind: 'children', typeIds: typeIds ?? [], locale, parentId },
      { ...read, spaceId: scopeSpaceId(scope) },
    );
    const result = await this.core.repos.content.pageTreeChildren(scope, locale, parentId, {
      ...page,
      hiddenTypeIds: await this.core.hiddenTypeIds(scope, typeIds),
    });
    const rows = await this.afterRead(
      result.items.map((item) => item.content),
      read,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items: TreeChild[] = [];
    for (const item of result.items) {
      const row = byId.get(item.content.id);
      if (!row) continue;
      items.push({ ...item, content: this.core.readable(row, actor) });
    }
    return { ...result, items };
  }

  /**
   * Documents in the tree whose title or text matches `term`, with their ancestors so the
   * caller can draw them in place. Hidden and unreadable ancestors are skipped.
   */
  async treeSearch(
    scope: Scope,
    locale: string,
    term: string,
    options: {
      limit?: number;
      actor?: Actor | null;
      /** Readable types; `null` is all. */
      typeIds?: string[] | null;
      /** Only these types count as matches; `null` is every tree type. */
      matchTypeIds?: string[] | null;
    } = {},
  ): Promise<TreeSearchResult> {
    const { actor = null, typeIds = null, matchTypeIds = null, limit = 50 } = options;
    const spaceId = scopeSpaceId(scope);
    const hidden = new Set(await this.core.hiddenTypeIds(scope, typeIds));
    const wanted = this.core.registry
      .forSpace(await this.core.resolve(scope))
      .map((type) => type.id)
      .filter((id) => !hidden.has(id) && (matchTypeIds === null || matchTypeIds.includes(id)));
    const typeahead = term.trim();
    if (!typeahead || !wanted.length) return { nodes: [], total: 0 };

    const found = await this.list(
      {
        spaceId,
        ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
        locale,
        typeahead,
        typeIds: wanted,
      },
      { limit, offset: 0 },
      [{ by: 'title', direction: 'asc' }],
      { actor },
    );
    const matchIds = new Set(found.items.map((row) => row.id));

    const missing = [...new Set(found.items.flatMap(pathAncestors))].filter(
      (id) => !matchIds.has(id),
    );
    let ancestors: ContentRow[] = [];
    if (missing.length) {
      const stored = await this.core.repos.content.listByIds(missing, false, scope);
      const rows = await this.afterRead(
        stored.filter((row) => !hidden.has(row.typeId)),
        readScope(scope, actor, false),
      );
      ancestors = rows.map((row) => this.core.readable(row, actor));
    }

    const rows = [...ancestors, ...found.items];
    const present = new Set(rows.map((row) => row.id));
    const nodes = rows.map((content) => ({
      content,
      parentId: pathAncestors(content).findLast((id) => present.has(id)) ?? null,
      match: matchIds.has(content.id),
    }));
    return { nodes, total: found.total };
  }

  async ancestorIds(scope: Scope, id: string): Promise<string[]> {
    await this.core.find(scope, id);
    const rows = await this.core.repos.content.listAncestors(id);
    const hidden = new Set(await this.core.hiddenTypeIds(scope));
    return rows
      .filter((row) => inScope(row, scope) && !hidden.has(row.typeId))
      .map((row) => row.id);
  }

  /** Versions past `retention.versionsDays` are left out unless a keep rule holds them. */
  async versions(scope: Scope, id: string, pagination?: Pagination) {
    await this.core.find(scope, id);
    const days = (await this.core.manablox.controls.resolved(scopeSpaceId(scope))).retention
      .versionsDays;
    return this.core.repos.content.pageVersions(id, pagination, retentionCutoff(days));
  }

  async versionSnapshot(
    scope: Scope,
    id: string,
    version: number,
    actor: Actor | null,
  ): Promise<ContentRow | null> {
    await this.core.find(scope, id);
    const row = await this.core.repos.content.findVersionSnapshot(id, version);
    return row ? this.core.readable(row, actor) : null;
  }

  async stored(scope: Scope, id: string): Promise<ContentRow | null> {
    const row = await this.core.repos.content.findById(id);
    return row && inScope(row, scope) ? row : null;
  }

  storedMany(scope: Scope, ids: string[]): Promise<ContentRow[]> {
    return this.core.repos.content.listByIds(ids, false, scope);
  }
}
