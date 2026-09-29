import type { MenuDetail } from '@manablox/admin-sdk/features/menus/queries';
import type { ApiErrorDetail } from '@manablox/admin-sdk/lib/api-errors';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { messageForKey } from '@manablox/admin-sdk/lib/messages';
import type { MenuItemTarget } from '@manablox/core';
import { ref } from 'vue';

/** A menu entry in the editor. `key` is local (unsaved entries have no id); `content` is resolved for the admin's locale. */
export interface EditorItem {
  key: string;
  id?: string;
  localizationId: string | null;
  label: string;
  url: string;
  /** Link target; only link entries offer it. */
  target: MenuItemTarget;
  content: {
    id: string;
    title: string;
    permalink: string | null;
    status: string;
    typeId: string;
  } | null;
  children: EditorItem[];
}

export type MenuOp =
  | { kind: 'move'; key: string; by: -1 | 1 }
  | { kind: 'indent'; key: string }
  | { kind: 'outdent'; key: string }
  | { kind: 'remove'; key: string }
  | { kind: 'update'; key: string; patch: Partial<Pick<EditorItem, 'label' | 'url' | 'target'>> }
  /** Moves `key` under `parentKey` (`null` for top level) at `index`, counted before removal. */
  | { kind: 'drop'; key: string; parentKey: string | null; index: number };

/** The menu editor's form. */
export interface MenuDraft {
  name: string;
  machineName: string;
  description: string;
  items: EditorItem[];
}

type ServerItem = MenuDetail['items'][number];

function toEditorItem(item: ServerItem): EditorItem {
  return {
    key: item.id,
    id: item.id,
    localizationId: item.localizationId,
    label: item.label ?? '',
    url: item.url ?? '',
    target: item.target,
    content: item.content
      ? {
          id: item.content.id,
          title: item.content.title,
          permalink: item.content.permalink,
          status: item.content.status,
          typeId: item.content.typeId,
        }
      : null,
    children: item.children.map(toEditorItem),
  };
}

export function menuToDraft(loaded: MenuDetail): MenuDraft {
  return {
    name: loaded.menu.name,
    machineName: loaded.menu.machineName,
    description: loaded.menu.description ?? '',
    items: loaded.items.map(toEditorItem),
  };
}

/** A new entry pointing at a document. */
export function contentItem(row: {
  id: string;
  localizationId: string;
  title: string;
  permalink: string | null;
  status: string;
  typeId: string;
}): EditorItem {
  return {
    key: crypto.randomUUID(),
    localizationId: row.localizationId,
    label: '',
    url: '',
    target: '_self',
    content: {
      id: row.id,
      title: row.title,
      permalink: row.permalink,
      status: row.status,
      typeId: row.typeId,
    },
    children: [],
  };
}

/** A new, empty link entry. */
export function linkItem(): EditorItem {
  return {
    key: crypto.randomUUID(),
    localizationId: null,
    label: '',
    url: '',
    target: '_self',
    content: null,
    children: [],
  };
}

/** An entry's parent list and index. */
function locate(
  items: EditorItem[],
  key: string,
  parent: EditorItem | null = null,
): { list: EditorItem[]; index: number; parent: EditorItem | null } | null {
  const index = items.findIndex((item) => item.key === key);
  if (index !== -1) return { list: items, index, parent };
  for (const item of items) {
    const found = locate(item.children, key, item);
    if (found) return found;
  }
  return null;
}

/** Mutates `items` in place; false when the op changes nothing. */
function applyTo(items: EditorItem[], op: MenuOp): boolean {
  const found = locate(items, op.key);
  if (!found) return false;
  const { list, index, parent } = found;
  const item = list[index] as EditorItem;

  switch (op.kind) {
    case 'move': {
      const to = index + op.by;
      if (to < 0 || to >= list.length) return false;
      list.splice(index, 1);
      list.splice(to, 0, item);
      return true;
    }
    case 'indent': {
      const above = list[index - 1];
      if (!above) return false;
      list.splice(index, 1);
      above.children.push(item);
      return true;
    }
    case 'outdent': {
      if (!parent) return false;
      const grand = locate(items, parent.key);
      if (!grand) return false;
      list.splice(index, 1);
      grand.list.splice(grand.index + 1, 0, item);
      return true;
    }
    case 'remove': {
      list.splice(index, 1);
      return true;
    }
    case 'update': {
      Object.assign(item, op.patch);
      return true;
    }
    case 'drop': {
      // Removing the entry first shifts later siblings up by one.
      const target = op.parentKey === null ? null : locate(items, op.parentKey);
      const destination = target ? target.list[target.index]?.children : items;
      if (!destination) return false;
      list.splice(index, 1);
      const at = destination === list && op.index > index ? op.index - 1 : op.index;
      destination.splice(Math.min(at, destination.length), 0, item);
      return true;
    }
  }
}

/** The tree after `op`, as a copy; `null` when the op changes nothing. */
export function applyMenuOp(items: EditorItem[], op: MenuOp): EditorItem[] | null {
  const copy = plainClone(items);
  return applyTo(copy, op) ? copy : null;
}

/** Every entry, flattened. */
export function countItems(items: EditorItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);
}

/** Error messages by entry key, from positional paths (`items.0.children.2`). */
export function itemErrors(
  items: EditorItem[],
  errors: readonly ApiErrorDetail[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const detail of errors) {
    const path = detail.path ?? [];
    if (path[0] !== 'items') continue;
    let list: EditorItem[] | undefined = items;
    let item: EditorItem | undefined;
    for (let i = 1; i < path.length; i += 2) {
      item = list?.[path[i] as number];
      list = item?.children;
    }
    if (item) out.set(item.key, messageForKey(detail.key, detail.params));
  }
  return out;
}

/** An entry as the save input takes it. */
export interface MenuItemInput {
  id?: string;
  localizationId: string | null;
  label: string | null;
  url: string | null;
  target: MenuItemTarget;
  children: MenuItemInput[];
}

export function toItemInput(item: EditorItem): MenuItemInput {
  return {
    ...(item.id ? { id: item.id } : {}),
    localizationId: item.localizationId,
    label: item.label.trim() || null,
    url: item.localizationId ? null : item.url.trim() || null,
    target: item.target,
    children: item.children.map(toItemInput),
  };
}

// --- drag state ------------------------------------------------------------------

/** The dragged entry's key. Module scope: drags cross levels, and the payload is only readable on drop. */
export const draggingKey = ref<string | null>(null);

/** The dragged entry, to check targets against its subtree. */
export const draggingItem = ref<{ key: string; children: unknown[] } | null>(null);

/** The one highlighted drop zone. */
export const dropZone = ref<{ key: string; mode: 'before' | 'into' | 'after' } | null>(null);

export function clearDrag(): void {
  draggingKey.value = null;
  draggingItem.value = null;
  dropZone.value = null;
}
