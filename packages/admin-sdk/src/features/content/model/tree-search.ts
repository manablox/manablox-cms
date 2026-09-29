import type { ContentTreeSearch } from '../../../lib/api-types';

type SearchNode = ContentTreeSearch['nodes'][number];
export type TreeSearchDocument = SearchNode['content'];

/** One row of a search result drawn as a tree. */
export interface TreeSearchRow {
  content: TreeSearchDocument;
  depth: number;
  match: boolean;
}

const siblingOrder = (a: SearchNode, b: SearchNode): number =>
  a.content.position - b.content.position || a.content.title.localeCompare(b.content.title);

/** Orders search nodes as the tree does, each after its parent, with its depth. */
export function searchRows(nodes: readonly SearchNode[]): TreeSearchRow[] {
  const children = new Map<string | null, SearchNode[]>();
  for (const node of nodes) {
    const level = children.get(node.parentId) ?? [];
    level.push(node);
    children.set(node.parentId, level);
  }

  const rows: TreeSearchRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of (children.get(parentId) ?? []).sort(siblingOrder)) {
      rows.push({ content: node.content, depth, match: node.match });
      walk(node.content.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** `title` split around each case-insensitive occurrence of `term`, for highlighting. */
export function highlightParts(title: string, term: string): { text: string; hit: boolean }[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [{ text: title, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const haystack = title.toLowerCase();
  let at = 0;
  for (let found = haystack.indexOf(needle); found !== -1; found = haystack.indexOf(needle, at)) {
    if (found > at) parts.push({ text: title.slice(at, found), hit: false });
    parts.push({ text: title.slice(found, found + needle.length), hit: true });
    at = found + needle.length;
  }
  if (at < title.length) parts.push({ text: title.slice(at), hit: false });
  return parts;
}
