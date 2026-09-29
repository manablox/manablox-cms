import {
  type ContentStatus,
  type ContentTypeRegistry,
  ManabloxError,
  type ResourceSource,
} from '@manablox/core';
import { eq, getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';
import type { Database, Executor } from '../../client.js';
import { idToLabel } from '../../columns.js';
import type { ContentTable } from '../../query.js';
import type { ContentRow } from '../../schema/index.js';
import { Repository } from '../base.js';
import { productionIds } from '../environment.js';
import { addTotals, documentMetric } from '../limit-count.js';

export interface ContentWriteData {
  id?: string | undefined;
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | null | undefined;
  typeId: string;
  locale: string;
  localizationId?: string | undefined;
  parentId?: string | null | undefined;
  title: string;
  slug: string;
  fields: Record<string, unknown>;
  searchText?: string | undefined;
  position?: number | undefined;
  status?: ContentStatus | undefined;
  /** Whether the content type contributes its slug to descendants' permalinks. */
  hasSlug: boolean;
  actorId?: string | null | undefined;
  /** `code` on a document a managed template declaration owns. */
  source?: ResourceSource | undefined;
  sourceRef?: string | null | undefined;
  /** Expected current version; a mismatch raises `content.version.conflict`. */
  expectedVersion?: number | undefined;
}

/** Whether a delete takes a node's children along or lifts them into its place. */
export type DeleteChildren = 'cascade' | 'reparent';

export interface TreeNode {
  content: ContentRow;
  depth: number;
  children: TreeNode[];
}

/** A row of one level of the tree, with what the level below it holds. */
export interface TreeChild {
  content: ContentRow;
  /** Children this node would load when expanded; 0 means no chevron. */
  childCount: number;
}

/** Sibling order within one parent. */
export const siblingOrder = (table: ContentTable): SQL =>
  sql`${table.position} asc, ${table.title} asc, ${table.id} asc`;

/** The ltree path of node `id` under `parentPath`. */
export function childPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}.${idToLabel(id)}` : idToLabel(id);
}

/** Appends a permalink segment; a slug-less level adds nothing. */
export function joinSegment(prefix: string, segment: string | null): string {
  if (segment === null) return prefix;
  return prefix ? `${prefix}/${segment}` : segment;
}

export function buildTree(
  rows: Array<ContentRow & { depth: number }>,
  rootId: string | null,
): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    const { depth, ...content } = row;
    nodes.set(row.id, { content: content as ContentRow, depth, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.content.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parentId !== rootId) parent.children.push(node);
    else if (parentId === rootId || !parent) roots.push(node);
  }
  return roots;
}

const readColumnSets = new WeakMap<ContentTable, SelectedFields>();

/** Row lookups every content part builds on; parts share one context and call each other. */
export abstract class ContentBase extends Repository {
  /**
   * Adds (`sign` 1) or removes (-1) `rows` in the document counters, on the write's executor.
   * Only production rows count.
   */
  protected async countRows(
    db: Executor,
    registry: ContentTypeRegistry | undefined,
    rows: ReadonlyArray<Pick<ContentRow, 'spaceId' | 'environmentId' | 'typeId'>>,
    sign: 1 | -1,
  ): Promise<void> {
    if (!registry || rows.length === 0) return;
    const production = await productionIds(
      db,
      this.t,
      rows.map((row) => row.environmentId),
    );
    const deltas = rows.flatMap((row) => {
      if (!production.has(row.environmentId)) return [];
      const metric = documentMetric(registry.tryGet(row.typeId)?.kind);
      return metric ? [{ spaceId: row.spaceId, metric, delta: sign }] : [];
    });
    if (deltas.length === 0) return;
    await addTotals(
      { db: db as Database, tables: this.t, dialect: this.dialect, unit: this.unit },
      deltas,
    );
  }

  protected table(published: boolean | undefined): ContentTable {
    return published ? this.t.publishedContents : this.t.contents;
  }

  /**
   * Columns a read returns. The published projection reads `search` and `searchText` as
   * null; delivery only filters on them.
   */
  protected readColumns(table: ContentTable): SelectedFields {
    let columns = readColumnSets.get(table);
    if (!columns) {
      columns = getTableColumns(table) as SelectedFields;
      if (table === this.t.publishedContents) {
        columns = {
          ...columns,
          search: sql<string | null>`null`,
          searchText: sql<string | null>`null`,
        };
      }
      readColumnSets.set(table, columns);
    }
    return columns;
  }

  /** The first row of `table` matching `where`, or `null`. */
  protected async findContentWhere(
    table: ContentTable,
    where: SQL | undefined,
  ): Promise<ContentRow | null> {
    const rows = await this.db.select(this.readColumns(table)).from(table).where(where).limit(1);
    return (rows[0] as ContentRow | undefined) ?? null;
  }

  /** The bare name of `table`, for hand-written SQL. */
  protected tableName(table: ContentTable): SQL {
    return table === this.t.contents ? sql`contents` : sql`published_contents`;
  }

  /** A subquery for the path of node `id`. */
  protected pathOf(table: ContentTable | SQL, id: string): SQL {
    return sql`(select path from ${table} where id = ${this.dialect.param(id, 'uuid')})`;
  }

  protected async findRow(db: Executor, id: string): Promise<ContentRow | null> {
    const { contents } = this.t;
    const rows = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    return (rows[0] as ContentRow | undefined) ?? null;
  }

  protected async lockRow(db: Executor, id: string): Promise<ContentRow> {
    const { contents } = this.t;
    const rows = await this.dialect.forUpdate(
      db.select().from(contents).where(eq(contents.id, id)).limit(1),
    );
    const row = rows[0] as ContentRow | undefined;
    if (!row) throw ManabloxError.notFound('content.notFound', { id });
    return row;
  }

  protected async parentPath(db: Executor, parentId: string | null): Promise<string | null> {
    if (!parentId) return null;
    const { contents } = this.t;
    const rows = await db
      .select({ path: contents.path })
      .from(contents)
      .where(eq(contents.id, parentId))
      .limit(1);
    const path = rows[0]?.path;
    if (!path) throw ManabloxError.notFound('content.parent.notFound', { id: parentId });
    return path;
  }

  protected async parentPermalinkPath(db: Executor, parentId: string | null): Promise<string> {
    if (!parentId) return '';
    const { contents } = this.t;
    const rows = await db
      .select({ permalinkPath: contents.permalinkPath })
      .from(contents)
      .where(eq(contents.id, parentId))
      .limit(1);
    return rows[0]?.permalinkPath ?? '';
  }
}
