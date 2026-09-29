import {
  auditor,
  diffRecords,
  type Loose,
  ManabloxError,
  type MenuItemTarget,
  purgeTags,
  type Scope,
  scopeOf,
  scopeSpaceId,
  snapshotChanges,
  spacePurgeTag,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type ContentRow,
  type MenuItemInput,
  type MenuItemNode,
  type MenuRow,
  type Repositories,
  type ResolvedMenuItem,
  rootRepositories,
  uniqueViolation,
  whenCommitted,
} from '@manablox/db';
import { onWrite } from './content/listeners.js';
import { hookScope, requireInSpace, resolveScope } from './lib.js';
import {
  type MenuPlacementInput,
  type MenuPlacementOption,
  menuPlacements,
  placeInTree,
} from './menu-placements.js';

export type {
  MenuPlacementEntry,
  MenuPlacementInput,
  MenuPlacementOption,
  MenuPlacementSpot,
} from './menu-placements.js';
export type { MenuItemInput, MenuItemNode, MenuRow, ResolvedMenuItem };

export interface MenuSaveInput {
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | undefined;
  name: string;
  machineName: string;
  description?: string | null | undefined;
}

/** A menu with its entries, as the admin edits it. */
export interface MenuDetail {
  menu: MenuRow;
  items: ResolvedMenuItem[];
}

/** A delivery entry; `label` falls back to the document's title. */
export interface PublicMenuItem {
  id: string;
  label: string;
  url: string | null;
  /** `_self` or `_blank`. */
  target: MenuItemTarget;
  content: ContentRow | null;
  children: PublicMenuItem[];
}

export interface PublicMenu {
  id: string;
  name: string;
  machineName: string;
  items: PublicMenuItem[];
}

/** Maps the `menus_space_machine_name_key` violation to a field error instead of a 500. */
const machineNameConflict = uniqueViolation({
  constraint: 'machine_name',
  key: 'menu.machineName.taken',
  path: ['machineName'],
  errorKey: 'menu.validation.failed',
});

/** Site navigation, separate from the content tree; entries may be documents or links. */
export class MenuService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = auditor(repos, 'menu', (menu: MenuRow) => menu.name);
  }

  /** This service on other repositories, e.g. a transaction's; hooks then run after commit. */
  using(repos: Repositories): MenuService {
    return new MenuService(this.manablox, repos);
  }

  /** Runs `fn` on this service bound to a transaction. */
  private atomic<T>(fn: (service: MenuService) => Promise<T>): Promise<T> {
    return this.repos.transaction((tx) => fn(this.using(tx)));
  }

  list(scope: Scope): Promise<MenuRow[]> {
    return this.repos.menus.listBySpace(scope);
  }

  /** The menu with its entries resolved for one locale, for the editor. */
  async get(scope: Scope, id: string, locale: string): Promise<MenuDetail> {
    const menu = await this.find(scope, id);
    return { menu, items: await this.repos.menus.resolve(menu, locale, false) };
  }

  async create(input: MenuSaveInput): Promise<MenuRow> {
    const scope: Scope = input.environmentId
      ? { spaceId: input.spaceId, environmentId: input.environmentId }
      : input.spaceId;
    await this.assertOn(scope);
    await this.manablox.hooks.run(
      'menu:beforeCreate',
      { spaceId: input.spaceId, name: input.name, machineName: input.machineName },
      { manablox: this.manablox, ...hookScope(scope) },
    );
    await this.manablox.controls.assertLimit(scope, 'menusPerSpace');
    return this.atomic(async (menus) => {
      const row = await menus.repos.menus
        .create({
          spaceId: input.spaceId,
          environmentId: input.environmentId,
          name: input.name,
          machineName: input.machineName,
          description: input.description ?? null,
        })
        .catch(machineNameConflict({ machineName: input.machineName }));
      await menus.afterWrite(row);
      await menus.audit.record('menu.create', row, snapshotChanges(row, 'created'));
      return row;
    });
  }

  async update(
    scope: Scope,
    id: string,
    input: Loose<Omit<MenuSaveInput, 'spaceId' | 'environmentId'>>,
  ): Promise<MenuRow> {
    await this.assertOn(scope);
    const before = await this.find(scope, id);
    return this.atomic(async (menus) => {
      const row = await menus.repos.menus
        .update(id, input)
        .catch(machineNameConflict({ machineName: input.machineName ?? '' }));
      await menus.afterWrite(row);
      await menus.audit.record('menu.update', row, diffRecords(before, row));
      return row;
    });
  }

  async delete(scope: Scope, id: string): Promise<void> {
    await this.assertOn(scope);
    const menu = await this.find(scope, id);
    await this.atomic(async (menus) => {
      await menus.repos.menus.delete(id);
      await whenCommitted(menus.repos, async () => {
        await this.manablox.hooks.run(
          'menu:afterDelete',
          { id, spaceId: menu.spaceId },
          { manablox: this.manablox, ...hookScope(scopeOf(menu)) },
        );
        await this.purge(menu);
      });
      await menus.audit.record('menu.delete', menu, snapshotChanges(menu, 'deleted'));
    });
  }

  /** Replaces the entries, validating all before writing. */
  async setItems(scope: Scope, id: string, items: MenuItemInput[]): Promise<MenuItemNode[]> {
    await this.assertOn(scope);
    const menu = await this.find(scope, id);
    await this.validateItems(scope, items);
    return this.atomic(async (menus) => {
      const before = await menus.repos.menus.listItemTree(id);
      const tree = await menus.repos.menus.setItems(id, items);
      await menus.afterWrite(menu);
      await menus.audit.record('menu.setItems', menu, [
        { path: 'items', from: flattenTree(before), to: flattenTree(tree) },
      ]);
      return tree;
    });
  }

  /** A menu by name, with the entries the locale can show. */
  async resolve(
    scope: Scope,
    machineName: string,
    locale: string,
    published = true,
  ): Promise<PublicMenu | null> {
    const menu = await this.repos.menus.findByMachineName(scope, machineName);
    if (!menu) return null;
    const items = await this.repos.menus.resolve(menu, locale, published);
    return {
      id: menu.id,
      name: menu.name,
      machineName: menu.machineName,
      items: toPublicItems(items),
    };
  }

  /** Drops deleted documents' entries once their last translation is gone, in the delete's transaction. */
  attach(): void {
    onWrite(this.manablox, 'content:afterDeleteMany', async (rows, { spaceId }, repos) => {
      const localizationIds = rows.map((row) => row.localizationId);
      const [first] = rows;
      const where = first ? { spaceId, environmentId: first.environmentId } : spaceId;
      const left = await repos.content.listExistingLocalizationIds(where, localizationIds);
      const gone = [...new Set(localizationIds)].filter((id) => !left.has(id));
      if (gone.length) await this.using(repos).forgetContent(where, gone);
    });
  }

  /** Menus a document is linked from, for the editor's hint. */
  usedIn(scope: Scope, localizationId: string): Promise<MenuRow[]> {
    return this.repos.menus.listByLocalizations(scope, localizationId);
  }

  /** Every menu of the space with the spot the document holds in it, for the editor's picker. */
  async placements(
    scope: Scope,
    localizationId: string,
    locale: string,
  ): Promise<MenuPlacementOption[]> {
    return menuPlacements(this.repos, scope, localizationId, locale);
  }

  /**
   * Puts the document at one spot in each named menu and takes it out of every other menu of
   * the space. Entries keep their id, so a move is not a delete and a re-add.
   */
  async setPlacements(
    scope: Scope,
    localizationId: string,
    placements: MenuPlacementInput[],
  ): Promise<MenuRow[]> {
    await this.assertOn(scope);
    return this.atomic((menus) => menus.place(scope, localizationId, placements));
  }

  private async place(
    scope: Scope,
    localizationId: string,
    placements: MenuPlacementInput[],
  ): Promise<MenuRow[]> {
    const wanted = new Map(placements.map((placement) => [placement.menuId, placement]));
    const menus = await this.repos.menus.listBySpace(scope);
    const known = new Set(menus.map((menu) => menu.id));
    for (const menuId of wanted.keys()) {
      if (!known.has(menuId)) throw ManabloxError.notFound('menu.notFound', { id: menuId });
    }

    const referencing = new Set(
      (await this.repos.menus.listByLocalizations(scope, localizationId)).map((menu) => menu.id),
    );
    const changed: MenuRow[] = [];
    for (const menu of menus) {
      const spot = wanted.get(menu.id);
      if (!spot && !referencing.has(menu.id)) continue;
      const tree = placeInTree(await this.repos.menus.listItemTree(menu.id), localizationId, spot);
      await this.setItems(scope, menu.id, tree);
      changed.push(menu);
    }
    return changed;
  }

  /** Whether the space's menus take writes. */
  async editable(scope: Scope): Promise<boolean> {
    return (await this.manablox.controls.feature(scopeSpaceId(scope), 'menus')).enabled;
  }

  private assertOn(scope: Scope): Promise<void> {
    return this.manablox.controls.assertFeature(scopeSpaceId(scope), 'menus');
  }

  /** Removes deleted documents' entries from every menu. */
  async forgetContent(scope: Scope, localizationIds: string | readonly string[]): Promise<void> {
    const affected = await this.repos.menus.listByLocalizations(scope, localizationIds);
    if (affected.length === 0) return;
    await this.repos.menus.deleteItemsByLocalizations(localizationIds);
    for (const menu of affected) await this.afterWrite(menu);
  }

  // -------------------------------------------------------------------------

  private async find(scope: Scope, id: string): Promise<MenuRow> {
    return requireInSpace(await this.repos.menus.findById(id), scope, 'menu.notFound', { id });
  }

  private async validateItems(scope: Scope, items: MenuItemInput[]): Promise<void> {
    const flat: { item: MenuItemInput; path: (string | number)[] }[] = [];
    const walk = (nodes: MenuItemInput[], path: (string | number)[]) => {
      nodes.forEach((item, index) => {
        const here = [...path, index];
        flat.push({ item, path: here });
        walk(item.children ?? [], [...here, 'children']);
      });
    };
    walk(items, ['items']);

    const problems: {
      key: 'menu.item.targetRequired' | 'menu.item.linkNeedsLabel';
      path: (string | number)[];
    }[] = [];
    for (const { item, path } of flat) {
      if (!item.localizationId && !item.url?.trim()) {
        problems.push({ key: 'menu.item.targetRequired', path });
      } else if (!item.localizationId && !item.label?.trim()) {
        problems.push({ key: 'menu.item.linkNeedsLabel', path });
      }
    }
    if (problems.length) throw ManabloxError.validation(problems, 'menu.validation.failed');

    const localizationIds = [
      ...new Set(flat.flatMap(({ item }) => (item.localizationId ? [item.localizationId] : []))),
    ];
    if (localizationIds.length === 0) return;

    // One lookup for all entries.
    const found = new Map<string, ContentRow>();
    for (const row of await this.repos.content.listByLocalizationIds(scope, localizationIds)) {
      found.set(row.localizationId, row);
    }

    const missing: {
      key: 'menu.item.contentNotFound' | 'menu.item.typeNotAllowed';
      path: (string | number)[];
      params: Record<string, unknown>;
    }[] = [];
    for (const { item, path } of flat) {
      if (!item.localizationId) continue;
      const row = found.get(item.localizationId);
      if (!row) {
        missing.push({
          key: 'menu.item.contentNotFound',
          path,
          params: { localizationId: item.localizationId },
        });
        continue;
      }
      const type = this.manablox.contentTypes.tryGet(row.typeId);
      if (type && !type.canBeVisibleInMenu) {
        missing.push({ key: 'menu.item.typeNotAllowed', path, params: { type: type.label } });
      }
    }
    if (missing.length) throw ManabloxError.validation(missing, 'menu.validation.failed');
  }

  /** Hooks and purge, after commit inside a transaction. */
  private afterWrite(menu: MenuRow): Promise<void> {
    return whenCommitted(this.repos, async () => {
      await this.manablox.hooks.run(
        'menu:afterWrite',
        { id: menu.id, spaceId: menu.spaceId },
        { manablox: this.manablox, ...hookScope(scopeOf(menu)) },
      );
      await this.purge(menu);
    });
  }

  /** Menus are cached under the space tag too; runs after commit. */
  private async purge(menu: MenuRow): Promise<void> {
    const scope = await resolveScope(rootRepositories(this.repos), scopeOf(menu));
    await purgeTags(this.manablox, menu.spaceId, [`menu:${menu.id}`, spacePurgeTag(scope)]);
  }
}

/** The entry tree as the audit log stores it. */
function flattenTree(nodes: MenuItemNode[]): unknown[] {
  return nodes.map((node) => ({
    localizationId: node.item.localizationId,
    label: node.item.label,
    url: node.item.url,
    ...(node.children.length ? { children: flattenTree(node.children) } : {}),
  }));
}

/** Drops content entries without a document in this locale, sub-entries included. */
export function toPublicItems(items: ResolvedMenuItem[]): PublicMenuItem[] {
  const out: PublicMenuItem[] = [];
  for (const item of items) {
    if (item.localizationId && !item.content) continue;
    out.push({
      id: item.id,
      label: item.label?.trim() || item.content?.title || item.url || '',
      url: item.url,
      target: item.target,
      content: item.content,
      children: toPublicItems(item.children),
    });
  }
  return out;
}
