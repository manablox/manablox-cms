import type {
  BlockDesign,
  DesignNode,
  LayoutDesign,
  PageDesign,
  SiteDesignData,
  SiteDesignKind,
} from './types.js';
import { clone, isRecord } from './util.js';

/** Node ids: a letter, then letters, digits, `-` or `_`; at most 40 characters. */
export const NODE_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

export interface NodeVisit {
  node: DesignNode;
  parent: DesignNode | null;
  index: number;
  /** 0 for the root. */
  depth: number;
}

/** Depth-first, parents before children. Returning `false` skips a node's children. */
export function walkNodes(root: DesignNode, visit: (entry: NodeVisit) => unknown): void {
  const step = (node: DesignNode, parent: DesignNode | null, index: number, depth: number) => {
    if (visit({ node, parent, index, depth }) === false) return;
    node.children?.forEach((child, childIndex) => {
      step(child, node, childIndex, depth + 1);
    });
  };
  step(root, null, 0, 0);
}

export function findNode(
  root: DesignNode,
  id: string,
): { node: DesignNode; parent: DesignNode | null; index: number; path: DesignNode[] } | null {
  const path: DesignNode[] = [];
  const search = (
    node: DesignNode,
    parent: DesignNode | null,
    index: number,
  ): { node: DesignNode; parent: DesignNode | null; index: number; path: DesignNode[] } | null => {
    if (node.id === id) return { node, parent, index, path: [...path] };
    path.push(node);
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const found = search(children[i] as DesignNode, node, i);
      if (found) return found;
    }
    path.pop();
    return null;
  };
  return search(root, null, 0);
}

export function collectNodeIds(root: DesignNode): Set<string> {
  const ids = new Set<string>();
  walkNodes(root, ({ node }) => {
    ids.add(node.id);
  });
  return ids;
}

/** A random id not in `taken`. */
export function newNodeId(taken: ReadonlySet<string> | DesignNode = new Set()): string {
  const used = taken instanceof Set ? taken : collectNodeIds(taken as DesignNode);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const crypto = (globalThis as { crypto?: { getRandomValues?(array: Uint8Array): Uint8Array } })
    .crypto;
  for (;;) {
    const bytes = new Uint8Array(7);
    if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let id = 'n';
    for (const byte of bytes) id += alphabet[byte % alphabet.length];
    if (!used.has(id)) return id;
  }
}

/** A copy of the tree with `fn` applied to the node `id`; `null` from `fn` removes it. */
function mapNode(
  root: DesignNode,
  id: string,
  fn: (node: DesignNode) => DesignNode | null,
): DesignNode | null {
  if (root.id === id) return fn(root);
  if (!root.children) return root;
  let changed = false;
  const children: DesignNode[] = [];
  for (const child of root.children) {
    const next = mapNode(child, id, fn);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  return changed ? { ...root, children } : root;
}

/** Applies `patch` to one node; returns a new tree, unchanged branches shared. */
export function updateNode(
  root: DesignNode,
  id: string,
  patch: (node: DesignNode) => DesignNode,
): DesignNode {
  return mapNode(root, id, patch) ?? root;
}

/** Inserts `node` into `parentId` at `index` (appended when out of range). */
export function insertNode(
  root: DesignNode,
  parentId: string,
  index: number,
  node: DesignNode,
): DesignNode {
  return updateNode(root, parentId, (parent) => {
    const children = [...(parent.children ?? [])];
    const at = index < 0 || index > children.length ? children.length : index;
    children.splice(at, 0, node);
    return { ...parent, children };
  });
}

/** Removes a node and its subtree. The root cannot be removed. */
export function removeNode(root: DesignNode, id: string): DesignNode {
  if (root.id === id) return root;
  return mapNode(root, id, () => null) ?? root;
}

/**
 * Moves a node into `parentId` at `index`, where `index` counts the parent's children
 * before the move. Moving a node into itself or its own subtree does nothing.
 */
export function moveNode(
  root: DesignNode,
  id: string,
  parentId: string,
  index: number,
): DesignNode {
  const found = findNode(root, id);
  if (!found?.parent) return root;
  if (found.node.id === parentId || findNode(found.node, parentId)) return root;
  let at = index;
  if (found.parent.id === parentId && found.index < index) at -= 1;
  return insertNode(removeNode(root, id), parentId, at, found.node);
}

/** Copies a node with fresh ids and places it right after the original. */
export function duplicateNode(
  root: DesignNode,
  id: string,
): { root: DesignNode; id: string | null } {
  const found = findNode(root, id);
  if (!found?.parent) return { root, id: null };
  const taken = collectNodeIds(root);
  const copy = cloneWithNewIds(found.node, taken);
  return { root: insertNode(root, found.parent.id, found.index + 1, copy), id: copy.id };
}

/** A deep copy with every id replaced by one not in `taken`; `taken` grows. */
export function cloneWithNewIds(node: DesignNode, taken: Set<string>): DesignNode {
  const copy = clone(node);
  walkNodes(copy, ({ node: entry }) => {
    entry.id = newNodeId(taken);
    taken.add(entry.id);
  });
  return copy;
}

/** The node trees of a design: every variant of a block, the root of a page or layout. */
export function designRoots(kind: SiteDesignKind, data: SiteDesignData | unknown): DesignNode[] {
  if (!isRecord(data)) return [];
  if (kind === 'block') {
    const variants = (data as Partial<BlockDesign>).variants;
    if (!isRecord(variants)) return [];
    return Object.keys(variants)
      .sort()
      .map((name) => (variants[name] as { root?: DesignNode } | undefined)?.root)
      .filter((root): root is DesignNode => isRecord(root));
  }
  if (kind === 'page' || kind === 'layout') {
    const root = (data as Partial<PageDesign | LayoutDesign>).root;
    return isRecord(root) ? [root] : [];
  }
  return [];
}
