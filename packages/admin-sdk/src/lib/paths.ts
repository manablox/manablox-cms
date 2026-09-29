/** Immutable get/set by path inside a document's fields, as the visual editor addresses them. */
export type FieldPath = (string | number)[];

export function getAt(root: unknown, path: FieldPath): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    // Indexes skip into `{ grid, blocks }.blocks`; names on a block or item skip into `fields`.
    if (typeof segment === 'number' && isBlocksContainer(current)) current = current.blocks;
    else if (typeof segment === 'string' && hasOwnFields(current, segment)) {
      current = current.fields;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** Own keys of a block and a repeater item; any other name refers to one of its fields. */
const OWN_BLOCK_KEYS = new Set(['blockId', 'type', 'fields', 'layout', 'ext']);
const OWN_ITEM_KEYS = new Set(['itemId', 'fields']);

/** Whether `name` on `value` addresses a field inside a block's or item's `fields`. */
function hasOwnFields(value: unknown, name: string): value is { fields: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { blockId?: unknown; itemId?: unknown; fields?: unknown };
  if (typeof record.fields !== 'object') return false;
  if (typeof record.blockId === 'string') return !OWN_BLOCK_KEYS.has(name);
  if (typeof record.itemId === 'string') return !OWN_ITEM_KEYS.has(name);
  return false;
}

function isBlocksContainer(value: unknown): value is { blocks: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

/** A copy with `value` at `path`, creating missing containers; `undefined` removes the key. */
export function setAt<T>(root: T, path: FieldPath, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string | number, ...FieldPath];

  if (typeof head === 'number' && isBlocksContainer(root)) {
    return { ...root, blocks: setAt(root.blocks, path, value) } as T;
  }
  if (typeof head === 'string' && hasOwnFields(root, head)) {
    return { ...root, fields: setAt(root.fields, path, value) } as T;
  }

  if (Array.isArray(root) || (root === undefined && typeof head === 'number')) {
    const list = Array.isArray(root) ? [...root] : [];
    const index = Number(head);
    list[index] = rest.length ? setAt(list[index], rest, value) : value;
    return list as T;
  }

  const record = root !== null && typeof root === 'object' ? { ...(root as object) } : {};
  const next = record as Record<string | number, unknown>;
  if (rest.length === 0 && value === undefined) delete next[head];
  else next[head] = rest.length ? setAt(next[head], rest, value) : value;
  return next as T;
}
