import type { Scope } from '@manablox/core';
import type {
  MenuItemInput,
  MenuItemNode,
  MenuRow,
  Repositories,
  ResolvedMenuItem,
} from '@manablox/db';

/** One entry of a menu, flattened for the placement picker. */
export interface MenuPlacementEntry {
  id: string;
  /** What the editor shows: the label, else the document's title, else the address. */
  label: string;
  depth: number;
  parentId: string | null;
  /** Whether this entry is the document being placed. */
  isSelf: boolean;
}

/** A menu as the "In menus" picker shows it, with where the document sits in it. */
export interface MenuPlacementOption {
  menu: MenuRow;
  entries: MenuPlacementEntry[];
  /** Null when the menu does not link the document. */
  placement: MenuPlacementSpot | null;
}

/** A spot in a menu: `index` counts siblings under `parentId` without the document's own entry. */
export interface MenuPlacementSpot {
  parentId: string | null;
  index: number;
}

export interface MenuPlacementInput extends MenuPlacementSpot {
  menuId: string;
}

/** Every menu of the space with the spot the document holds in it. */
export async function menuPlacements(
  repos: Repositories,
  scope: Scope,
  localizationId: string,
  locale: string,
): Promise<MenuPlacementOption[]> {
  const menus = await repos.menus.listBySpace(scope);
  const options: MenuPlacementOption[] = [];
  for (const menu of menus) {
    const items = await repos.menus.resolve(menu, locale, false);
    const entries: MenuPlacementEntry[] = [];
    const spots: MenuPlacementSpot[] = [];
    const walk = (nodes: ResolvedMenuItem[], parentId: string | null, depth: number) => {
      let index = 0;
      for (const node of nodes) {
        const isSelf = node.localizationId === localizationId;
        if (isSelf) spots.push({ parentId, index });
        entries.push({
          id: node.id,
          label: node.label?.trim() || node.content?.title || node.url || 'Untitled entry',
          depth,
          parentId,
          isSelf,
        });
        // A later sibling sits one lower once the document's own entry is taken out.
        if (!isSelf) index += 1;
        walk(node.children, node.id, depth + 1);
      }
    };
    walk(items, null, 0);
    options.push({ menu, entries, placement: spots[0] ?? null });
  }
  return options;
}

/** The stored tree as write input with the document moved to `spot`, or taken out without one. */
export function placeInTree(
  nodes: MenuItemNode[],
  localizationId: string,
  spot: MenuPlacementSpot | undefined,
): MenuItemInput[] {
  const tree = toInputs(nodes);
  // A move takes the sub-entries along; leaving a menu leaves them behind.
  const entry = takeContent(tree, localizationId, Boolean(spot));
  if (spot) {
    insertAt(
      tree,
      entry ?? { localizationId, label: null, url: null, target: '_self', children: [] },
      spot,
    );
  }
  return tree;
}

/** The stored tree as write input, ids kept so entries survive a rewrite. */
function toInputs(nodes: MenuItemNode[]): MenuItemInput[] {
  return nodes.map((node) => ({
    id: node.item.id,
    localizationId: node.item.localizationId,
    label: node.item.label,
    url: node.item.url,
    target: node.item.target,
    children: toInputs(node.children),
  }));
}

/**
 * Takes the document's entry out of the tree and returns it. With `keepChildren` the entry takes
 * its sub-entries along; otherwise they stay where the entry was. A duplicate entry is dropped
 * too and always leaves its sub-entries in its place.
 */
function takeContent(
  nodes: MenuItemInput[],
  localizationId: string,
  keepChildren: boolean,
): MenuItemInput | null {
  const first = findContent(nodes, localizationId);
  if (!first) return null;
  const walk = (list: MenuItemInput[]) => {
    let index = 0;
    while (index < list.length) {
      const node = list[index] as MenuItemInput;
      if (node === first) {
        list.splice(index, 1, ...(keepChildren ? [] : (node.children ?? [])));
        if (!keepChildren) node.children = [];
        continue;
      }
      if (node.localizationId === localizationId) {
        // The sub-entries take the duplicate's place and are scanned in turn.
        list.splice(index, 1, ...(node.children ?? []));
        continue;
      }
      walk(node.children ?? []);
      index += 1;
    }
  };
  walk(nodes);
  return first;
}

/** The first entry for the document, in the order the menu renders. */
function findContent(nodes: MenuItemInput[], localizationId: string): MenuItemInput | null {
  for (const node of nodes) {
    if (node.localizationId === localizationId) return node;
    const found = findContent(node.children ?? [], localizationId);
    if (found) return found;
  }
  return null;
}

/** Inserts the entry under `parentId`; an unknown parent (its own sub-entry) lands at the top level. */
function insertAt(nodes: MenuItemInput[], entry: MenuItemInput, spot: MenuPlacementSpot): void {
  const parent = spot.parentId ? findById(nodes, spot.parentId) : null;
  if (parent && !parent.children) parent.children = [];
  const list = parent?.children ?? nodes;
  list.splice(Math.max(0, Math.min(spot.index, list.length)), 0, entry);
}

function findById(nodes: MenuItemInput[], id: string): MenuItemInput | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findById(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}
