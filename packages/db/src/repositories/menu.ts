import { randomUUID } from 'node:crypto';
import { type Loose, ManabloxError, type MenuItemTarget, type Scope } from '@manablox/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { ContentRow, MenuItemRow, MenuRow } from '../schema/index.js';
import type { Tables } from '../tables.js';
import { Repository } from './base.js';

export interface MenuWriteData {
  id?: string | undefined;
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | null | undefined;
  name: string;
  machineName: string;
  description?: string | null | undefined;
}

/** A saved entry: `localizationId` for content or `url` for a link; a given `id` is kept. */
export interface MenuItemInput {
  id?: string | undefined;
  localizationId?: string | null | undefined;
  label?: string | null | undefined;
  url?: string | null | undefined;
  /** Defaults to `_self`. */
  target?: MenuItemTarget | undefined;
  children?: MenuItemInput[] | undefined;
}

export interface MenuItemNode {
  item: MenuItemRow;
  children: MenuItemNode[];
}

/** An entry with its document looked up for one locale; `content` is null for a link. */
export interface ResolvedMenuItem {
  id: string;
  label: string | null;
  url: string | null;
  target: MenuItemTarget;
  localizationId: string | null;
  content: ContentRow | null;
  children: ResolvedMenuItem[];
}

export class MenuRepository extends Repository {
  async listBySpace(scope: Scope): Promise<MenuRow[]> {
    const { menus } = this.t;
    return this.db.select().from(menus).where(this.inEnvironment(menus, scope)).orderBy(menus.name);
  }

  findById(id: string): Promise<MenuRow | null> {
    return this.findOne(this.t.menus, id);
  }

  findByMachineName(scope: Scope, machineName: string): Promise<MenuRow | null> {
    const { menus } = this.t;
    return this.findOneWhere(
      menus,
      and(this.inEnvironment(menus, scope), eq(menus.machineName, machineName)),
    );
  }

  async create(data: MenuWriteData): Promise<MenuRow> {
    const { menus } = this.t;
    const [row] = await this.db
      .insert(menus)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        environmentId: this.environmentOf(data),
        name: data.name,
        machineName: data.machineName,
        description: data.description ?? null,
      })
      .returning();
    if (!row) throw new ManabloxError('menu.create.failed');
    return row;
  }

  async update(
    id: string,
    data: Loose<Omit<MenuWriteData, 'spaceId' | 'environmentId'>>,
  ): Promise<MenuRow> {
    const { menus } = this.t;
    const [row] = await this.db
      .update(menus)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.machineName !== undefined ? { machineName: data.machineName } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(menus.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('menu.notFound', { id });
    return row;
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.menus, id);
  }

  /** Every entry of a menu, flat, ordered by position. */
  async listItems(menuId: string): Promise<MenuItemRow[]> {
    const { menuItems } = this.t;
    return this.db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId))
      .orderBy(asc(menuItems.position), asc(menuItems.id));
  }

  async listItemTree(menuId: string): Promise<MenuItemNode[]> {
    return buildTree(await this.listItems(menuId));
  }

  /** Replaces the whole tree in one transaction. */
  async setItems(menuId: string, tree: MenuItemInput[]): Promise<MenuItemNode[]> {
    const { menuItems, menus } = this.t;
    const rows: Tables['menuItems']['$inferInsert'][] = [];
    const flatten = (nodes: MenuItemInput[], parentId: string | null) => {
      nodes.forEach((node, position) => {
        const id = node.id ?? randomUUID();
        rows.push({
          id,
          menuId,
          parentId,
          position,
          localizationId: node.localizationId ?? null,
          label: node.label ?? null,
          url: node.url ?? null,
          target: node.target ?? '_self',
        });
        flatten(node.children ?? [], id);
      });
    };
    flatten(tree, null);

    return this.db.transaction(async (tx) => {
      await tx.delete(menuItems).where(eq(menuItems.menuId, menuId));
      // Sliced for the wire protocol's parameter ceiling.
      for (const batch of batches(rows, 8, this.dialect.maxParameters)) {
        await tx.insert(menuItems).values(batch);
      }
      await tx.update(menus).set({ updatedAt: new Date() }).where(eq(menus.id, menuId));
      return buildTree(rows.map((row) => ({ ...row, position: row.position ?? 0 }) as MenuItemRow));
    });
  }

  /** Menus that reference any of the documents. */
  async listByLocalizations(
    scope: Scope,
    localizationIds: string | readonly string[],
  ): Promise<MenuRow[]> {
    const ids = typeof localizationIds === 'string' ? [localizationIds] : [...localizationIds];
    if (ids.length === 0) return [];
    const { menuItems, menus } = this.t;
    return this.db
      .selectDistinct({
        id: menus.id,
        spaceId: menus.spaceId,
        environmentId: menus.environmentId,
        name: menus.name,
        machineName: menus.machineName,
        description: menus.description,
        createdAt: menus.createdAt,
        updatedAt: menus.updatedAt,
      })
      .from(menuItems)
      .innerJoin(menus, eq(menuItems.menuId, menus.id))
      .where(and(this.inEnvironment(menus, scope), inArray(menuItems.localizationId, ids)))
      .orderBy(menus.name);
  }

  /** Drops every entry pointing at the documents, in every menu; sub-entries cascade. */
  async deleteItemsByLocalizations(localizationIds: string | readonly string[]): Promise<boolean> {
    const ids = typeof localizationIds === 'string' ? [localizationIds] : [...localizationIds];
    if (ids.length === 0) return false;
    const { menuItems } = this.t;
    return this.removeWhere(menuItems, inArray(menuItems.localizationId, ids));
  }

  /** The tree with each entry's document in one locale; missing ones are `content: null`. */
  async resolve(menu: MenuRow, locale: string, published = false): Promise<ResolvedMenuItem[]> {
    const items = await this.listItems(menu.id);
    const localizationIds = [
      ...new Set(items.flatMap((item) => (item.localizationId ? [item.localizationId] : []))),
    ];

    const table = published ? this.t.publishedContents : this.t.contents;
    const rows = localizationIds.length
      ? await this.db
          .select()
          .from(table)
          .where(
            and(
              eq(table.environmentId, menu.environmentId),
              eq(table.locale, locale),
              inArray(table.localizationId, localizationIds),
            ),
          )
      : [];
    const byLocalization = new Map(rows.map((row) => [row.localizationId, row]));

    const toResolved = (node: MenuItemNode): ResolvedMenuItem => ({
      id: node.item.id,
      label: node.item.label,
      url: node.item.url,
      target: node.item.target,
      localizationId: node.item.localizationId,
      content: node.item.localizationId
        ? (byLocalization.get(node.item.localizationId) ?? null)
        : null,
      children: node.children.map(toResolved),
    });
    return buildTree(items).map(toResolved);
  }
}

function buildTree(rows: MenuItemRow[]): MenuItemNode[] {
  const nodes = new Map<string, MenuItemNode>();
  for (const row of rows) nodes.set(row.id, { item: row, children: [] });

  const roots: MenuItemNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId ? nodes.get(node.item.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const byPosition = (a: MenuItemNode, b: MenuItemNode) => a.item.position - b.item.position;
  const sort = (list: MenuItemNode[]) => {
    list.sort(byPosition);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}
