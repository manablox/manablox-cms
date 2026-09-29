import { type ContentTypeRegistry, ManabloxError, type Scope, scopeSpaceId } from '@manablox/core';
import { and, asc, count, eq, inArray, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { batches } from '../../batch.js';
import type { Executor } from '../../client.js';
import { DEFAULT_PAGE_SIZE, type Paginated, paginate } from '../../pagination.js';
import type { ContentTable } from '../../query.js';
import type { ContentRow } from '../../schema/index.js';
import type { DatabaseContext } from '../base.js';
import {
  buildTree,
  ContentBase,
  childPath,
  type DeleteChildren,
  siblingOrder,
  type TreeChild,
  type TreeNode,
} from './shared.js';

/** Hierarchy reads and the structural writes that keep paths and permalinks consistent. */
export class ContentTree extends ContentBase {
  constructor(
    context: DatabaseContext,
    private readonly registry?: ContentTypeRegistry,
  ) {
    super(context);
  }

  /** The whole tree below `rootId` in one query. */
  async listTree(
    scope: Scope,
    locale: string,
    rootId: string | null = null,
    maxDepth = 32,
    published = false,
  ): Promise<TreeNode[]> {
    const table = this.table(published);

    const d = this.dialect;
    const depth = d.pathDepth(table.path);

    const below = rootId
      ? sql`and ${d.pathWithin(table.path, this.pathOf(table, rootId))}
             and ${table.id} <> ${d.param(rootId, 'uuid')}`
      : sql``;

    const depthLimit = rootId
      ? sql`and ${depth} <= ${d.pathDepth(this.pathOf(table, rootId))} + ${maxDepth}`
      : sql`and ${depth} <= ${maxDepth}`;

    const rows = await this.db
      .select({ ...this.readColumns(table), depth: sql<number>`${depth}`.mapWith(Number) })
      .from(table)
      .where(
        sql`${table.spaceId} = ${d.param(scopeSpaceId(scope), 'uuid')} and ${table.environmentId} = ${this.environmentParam(scope)} and ${table.locale} = ${locale} ${below} ${depthLimit}`,
      )
      .orderBy(sql`${depth} asc, ${siblingOrder(table)}`);

    return buildTree(rows as Array<ContentRow & { depth: number }>, rootId);
  }

  /**
   * One page of the children of `parentId`. Rows of `hiddenTypeIds` are skipped and their
   * children take their place: a child is any visible descendant with no visible ancestor
   * in between.
   *
   * Read along `parent_id` (an index lookup per level) rather than by path: the hidden rows
   * that stand between the parent and its children first (usually none), then the visible
   * rows under the parent or under one of those, then their child counts the same way.
   */
  async pageTreeChildren(
    scope: Scope,
    locale: string,
    parentId: string | null = null,
    options: {
      limit?: number;
      offset?: number;
      hiddenTypeIds?: readonly string[];
      published?: boolean;
    } = {},
  ): Promise<Paginated<TreeChild>> {
    const table = this.table(options.published);
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const offset = options.offset ?? 0;
    const hidden = [...new Set(options.hiddenTypeIds ?? [])];
    const inLevel = and(this.inEnvironment(table, scope), eq(table.locale, locale));
    const visible = hidden.length ? notInArray(table.typeId, hidden) : undefined;

    const lifted = await this.hiddenBelow(
      table,
      hidden,
      parentId === null ? null : [parentId],
      inLevel,
    );
    const parents = [...new Set(lifted.map((row) => row.id))];
    const under = parentId === null ? isNull(table.parentId) : eq(table.parentId, parentId);
    const page = await paginate<ContentRow>(this.db, table, {
      where: and(
        inLevel,
        visible,
        parents.length ? or(under, inArray(table.parentId, parents)) : under,
      ),
      orderBy: [asc(table.position), asc(table.title)],
      pagination: { limit, offset },
      columns: this.readColumns(table),
    });

    const ids = page.items.map((row) => row.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      // Each counted row's parent is a page row or a hidden row below one.
      const rootOf = new Map(ids.map((id) => [id, id]));
      for (const row of await this.hiddenBelow(table, hidden, ids, inLevel)) {
        rootOf.set(row.id, row.root);
      }
      for (const batch of batches(
        [...rootOf.keys()],
        1,
        this.dialect.maxParameters - hidden.length - 4,
      )) {
        const rows = await this.db
          .select({ parentId: table.parentId, count: count() })
          .from(table)
          .where(and(inLevel, visible, inArray(table.parentId, batch)))
          .groupBy(table.parentId);
        for (const row of rows) {
          const root = row.parentId ? rootOf.get(row.parentId) : undefined;
          if (root) counts.set(root, (counts.get(root) ?? 0) + row.count);
        }
      }
    }
    return {
      ...page,
      items: page.items.map((content) => ({ content, childCount: counts.get(content.id) ?? 0 })),
    };
  }

  /**
   * The hidden rows below each of `parentIds` (the roots for `null`) with only hidden rows
   * in between, with the parent they hang under; nothing without hidden types.
   */
  private async hiddenBelow(
    table: ContentTable,
    hidden: readonly string[],
    parentIds: readonly string[] | null,
    inLevel: SQL | undefined,
  ): Promise<Array<{ root: string; id: string }>> {
    if (hidden.length === 0) return [];
    const out: Array<{ root: string; id: string }> = [];
    const hiddenType = inArray(table.typeId, [...hidden]);
    let level: Array<{ root: string; id: string }> = [];
    if (parentIds === null) {
      const rows = await this.db
        .select({ id: table.id })
        .from(table)
        .where(and(inLevel, hiddenType, isNull(table.parentId)));
      level = rows.map((row) => ({ root: '', id: row.id }));
    } else {
      level = parentIds.map((id) => ({ root: id, id }));
    }
    if (parentIds === null) out.push(...level);
    // Level by level; hidden rows nest rarely and never deeply.
    for (let depth = 0; level.length > 0 && depth < 64; depth++) {
      const rootOf = new Map(level.map((row) => [row.id, row.root]));
      const next: Array<{ root: string; id: string }> = [];
      for (const batch of batches(
        [...rootOf.keys()],
        1,
        this.dialect.maxParameters - hidden.length - 4,
      )) {
        const rows = await this.db
          .select({ id: table.id, parentId: table.parentId })
          .from(table)
          .where(and(inLevel, hiddenType, inArray(table.parentId, batch)));
        for (const row of rows) {
          const root = rootOf.get(row.parentId as string) ?? '';
          next.push({ root: parentIds === null ? '' : root, id: row.id });
        }
      }
      out.push(...next);
      level = next;
    }
    return out;
  }

  /** Ancestors of a node, root first. */
  async listAncestors(id: string, published = false): Promise<ContentRow[]> {
    const table = this.table(published);
    const rows = await this.db
      .select(this.readColumns(table))
      .from(table)
      .where(
        sql`${this.dialect.pathWithin(this.pathOf(table, id), table.path)}
            and ${table.id} <> ${this.dialect.param(id, 'uuid')}`,
      )
      .orderBy(sql`${this.dialect.pathDepth(table.path)} asc`);
    return rows as ContentRow[];
  }

  /**
   * Reparents and reorders without a version bump or snapshot, so an open editor does not
   * hit a version conflict. Siblings on both sides are renumbered densely.
   */
  async move(id: string, parentId: string | null, position: number): Promise<ContentRow> {
    const { contents } = this.t;
    return this.db.transaction(async (tx) => {
      const current = await this.findRow(tx, id);
      if (!current) throw ManabloxError.notFound('content.notFound', { id });

      await this.assertNotOwnDescendant(tx, id, parentId);

      const newPath = childPath(await this.parentPath(tx, parentId), id);
      const parentChanged = parentId !== current.parentId;

      // Tree order minus the moved node, so `position` indexes the list the user saw.
      const siblings = await this.siblingIds(tx, current.environmentId, current.locale, parentId);
      const order = siblings.filter((sibling) => sibling !== id);
      const index = Math.max(0, Math.min(position, order.length));
      order.splice(index, 0, id);

      await tx
        .update(contents)
        .set({ parentId, path: newPath, updatedAt: new Date() })
        .where(eq(contents.id, id));

      await this.renumber(tx, order);

      if (parentChanged) {
        await this.moveSubtree(tx, id, current.path, newPath);
        await this.recomputePermalinks(tx, contents, id);

        // Close the gap in the list the node left.
        await this.renumber(
          tx,
          await this.siblingIds(tx, current.environmentId, current.locale, current.parentId),
        );
      }

      const fresh = await this.findRow(tx, id);
      if (!fresh) throw ManabloxError.notFound('content.notFound', { id });
      return fresh;
    });
  }

  /** Deletes a node from draft and published tables; returns the deleted drafts, the node first. */
  async deleteReturning(id: string, children: DeleteChildren = 'cascade'): Promise<ContentRow[]> {
    const { contents } = this.t;
    const d = this.dialect;
    return this.db.transaction(async (tx) => {
      const current = await this.findRow(tx, id);
      if (!current) throw ManabloxError.notFound('content.notFound', { id });

      if (children === 'reparent') {
        await this.liftChildren(tx, current);
        // Only this row: its children were lifted and must survive.
        await d.run(tx, sql`delete from published_contents where id = ${d.param(id, 'uuid')}`);
        const deleted = (await tx
          .delete(contents)
          .where(eq(contents.id, id))
          .returning()) as ContentRow[];
        await this.countRows(tx, this.registry, deleted, -1);
        return deleted;
      }

      await d.run(
        tx,
        sql`delete from published_contents
          where ${d.pathWithin(sql`path`, this.pathOf(sql`contents`, id))}`,
      );

      const deleted = (await tx
        .delete(contents)
        .where(d.pathWithin(contents.path, d.param(current.path, 'ltree')))
        .returning()) as ContentRow[];
      await this.countRows(tx, this.registry, deleted, -1);
      return deleted.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0));
    });
  }

  /** Draft ids under one parent in tree order. */
  private async siblingIds(
    db: Executor,
    environmentId: string,
    locale: string,
    parentId: string | null,
  ): Promise<string[]> {
    const { contents } = this.t;
    const rows = (await db
      .select({ id: contents.id })
      .from(contents)
      .where(
        and(
          eq(contents.environmentId, environmentId),
          eq(contents.locale, locale),
          parentId === null ? sql`${contents.parentId} is null` : eq(contents.parentId, parentId),
        ),
      )
      .orderBy(siblingOrder(contents))) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** Renumbers a sibling list in one statement, skipping rows already in place. */
  private async renumber(db: Executor, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const values = this.dialect.values(
      { id: 'uuid', pos: 'int' },
      ids.map((id, pos) => ({ id, pos })),
    );
    await this.dialect.run(
      db,
      sql`
      update contents
      set position = v.pos
      from ${values} v
      where contents.id = v.id and contents.position is distinct from v.pos
    `,
    );
  }

  /** Rewrites descendant paths under `oldPath` to hang off `newPath`. */
  async moveSubtree(
    db: Executor,
    id: string,
    oldPath: string,
    newPath: string,
    table: ContentTable = this.t.contents,
  ): Promise<void> {
    const d = this.dialect;
    await d.run(
      db,
      sql`
      update ${this.tableName(table)}
      set path = ${d.pathRebase(sql`path`, oldPath, newPath)},
          updated_at = ${d.now()}
      where ${d.pathWithin(sql`path`, d.param(oldPath, 'ltree'))} and id <> ${d.param(id, 'uuid')}
    `,
    );
  }

  /** Recomputes permalinks for a node and its descendants; `concat_ws` drops slug-less levels. */
  async recomputePermalinks(db: Executor, table: ContentTable, rootId: string): Promise<void> {
    const d = this.dialect;
    const tableName = this.tableName(table);
    await d.run(
      db,
      sql`
      with recursive t as (
        select c.id,
               c.permalink_segment,
               concat_ws('/',
                 nullif(coalesce(
                   (select p.permalink_path from ${tableName} p where p.id = c.parent_id), ''), ''),
                 c.permalink_segment
               ) as prefix
        from ${tableName} c
        where c.id = ${d.param(rootId, 'uuid')}

        union all

        select ch.id,
               ch.permalink_segment,
               concat_ws('/', nullif(t.prefix, ''), ch.permalink_segment) as prefix
        from ${tableName} ch
        join t on ch.parent_id = t.id
      )
      update ${tableName} as target
      set permalink_path = t.prefix,
          permalink = case when t.permalink_segment is null then null else nullif(t.prefix, '') end,
          updated_at = ${d.now()}
      from t
      where target.id = t.id
        and (target.permalink_path is distinct from t.prefix
             or target.permalink is distinct from
                (case when t.permalink_segment is null then null else nullif(t.prefix, '') end))
    `,
    );
  }

  /** Rejects making a node its own ancestor. */
  async assertNotOwnDescendant(db: Executor, id: string, parentId: string | null): Promise<void> {
    if (!parentId) return;
    if (parentId === id) throw ManabloxError.badRequest('content.parent.self');

    const d = this.dialect;
    const rows = await db
      .select({
        cycle: sql<boolean>`exists (
          select 1 from contents p
          where p.id = ${d.param(parentId, 'uuid')}
            and ${d.pathWithin(sql`p.path`, this.pathOf(sql`contents`, id))}
        )`,
      })
      .from(sql`(select 1) as _`);

    if (rows[0]?.cycle) throw ManabloxError.badRequest('content.parent.cycle', { id, parentId });
  }

  /** Moves a node's children into its slot under its parent, in draft and projection. */
  private async liftChildren(db: Executor, node: ContentRow): Promise<void> {
    const { contents, publishedContents } = this.t;
    const children = (await db
      .select({ id: contents.id, path: contents.path })
      .from(contents)
      .where(eq(contents.parentId, node.id))
      .orderBy(siblingOrder(contents))) as { id: string; path: string }[];
    if (children.length === 0) return;

    // Destination order, read before anything moves.
    const siblings = await this.siblingIds(db, node.environmentId, node.locale, node.parentId);
    const order = siblings.flatMap((sibling) =>
      sibling === node.id ? children.map((child) => child.id) : [sibling],
    );

    const parentPath = await this.parentPath(db, node.parentId);
    for (const child of children) {
      const newPath = childPath(parentPath, child.id);
      for (const table of [contents, publishedContents] as const) {
        await db
          .update(table)
          .set({ parentId: node.parentId, path: newPath, updatedAt: new Date() })
          .where(eq(table.id, child.id));
        await this.moveSubtree(db, child.id, child.path, newPath, table);
        await this.recomputePermalinks(db, table, child.id);
      }
    }

    await this.renumber(db, order);
  }
}
