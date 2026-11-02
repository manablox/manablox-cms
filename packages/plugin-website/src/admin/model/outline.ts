import {
  canContain,
  canPlace,
  type DesignNode,
  type DesignSourceType,
  ELEMENTS,
  type ElementKind,
  findNode,
  generateBlockDesign,
  insertNode,
  moveNode,
  type SiteDesignKind,
  updateNode,
  walkNodes,
} from '@manablox/site';
import {
  type BindingOption,
  bindingOptions,
  type DesignField,
  defaultFormat,
  repeatScope,
} from './bindings';
import { ELEMENT_LABELS } from './elements';

/** Node prop holding the name an editor gave a node; the renderer ignores it. */
export const LABEL_PROP = 'designLabel';

/** One line of the outline tree. */
export interface OutlineRow {
  id: string;
  el: ElementKind;
  depth: number;
  label: string;
  parentId: string | null;
  childCount: number;
  container: boolean;
}

/** An editor's name, else the bound field, else static text or an input's label, else the element's name. */
export function nodeLabel(node: DesignNode, bindingLabel?: (path: string) => string): string {
  const own = node.props?.[LABEL_PROP];
  if (typeof own === 'string' && own.trim()) return own.trim();
  const path = node.bind?.field;
  if (path) return bindingLabel ? bindingLabel(path) : path;
  // Inputs are named by their label.
  const text = node.el === 'formField' ? node.props?.label : node.props?.text;
  if (text && typeof text === 'object') {
    const first = Object.values(text as Record<string, unknown>).find(
      (value) => typeof value === 'string' && value.trim(),
    );
    if (typeof first === 'string') return first.length > 40 ? `${first.slice(0, 39)}...` : first;
  }
  return ELEMENT_LABELS[node.el] ?? node.el;
}

/** The tree as rows, parents first; children of `collapsed` ids are left out. */
export function outlineRows(
  root: DesignNode,
  label: (node: DesignNode) => string,
  collapsed: ReadonlySet<string> = new Set(),
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  walkNodes(root, ({ node, parent, depth }) => {
    rows.push({
      id: node.id,
      el: node.el,
      depth,
      label: label(node),
      parentId: parent?.id ?? null,
      childCount: node.children?.length ?? 0,
      container: ELEMENTS[node.el]?.container ?? false,
    });
    return collapsed.has(node.id) ? false : undefined;
  });
  return rows;
}

/** Element kinds from the root down to `id`, inclusive. */
function kindsTo(root: DesignNode, id: string): ElementKind[] | null {
  const found = findNode(root, id);
  return found ? [...found.path, found.node].map((node) => node.el) : null;
}

/** Whether every sub-field binding in `node` has its `repeat` in `repeats` or inside `node`. */
function scopeFits(node: DesignNode, repeats: readonly string[]): boolean {
  let ok = true;
  const check = (entry: DesignNode, scope: readonly string[]) => {
    for (const path of [entry.bind?.field, entry.visibility?.whenField]) {
      if (typeof path !== 'string' || path.startsWith('$')) continue;
      const segments = path.split('.');
      if (segments.length > 1 && !scope.includes(segments.slice(0, -1).join('.'))) ok = false;
    }
    const inner =
      entry.el === 'repeat' && typeof entry.bind?.field === 'string'
        ? [...scope, entry.bind.field]
        : scope;
    for (const child of entry.children ?? []) check(child, inner);
  };
  check(node, repeats);
  return ok;
}

/**
 * Whether `node` may go into `parentId`: the parent takes children of its kind, every
 * element of the subtree is allowed under its new ancestors, a move does not go into its own
 * subtree, and sub-field bindings keep their `repeat`.
 */
export function canDropInto(
  root: DesignNode,
  designKind: SiteDesignKind,
  node: DesignNode,
  parentId: string,
  movingId?: string,
): boolean {
  const ancestors = kindsTo(root, parentId);
  const parent = findNode(root, parentId)?.node;
  if (!ancestors || !parent) return false;
  if (movingId && (movingId === parentId || findNode(node, parentId))) return false;
  if (!canContain(parent.el, node.el)) return false;
  let ok = true;
  const visit = (entry: DesignNode, above: ElementKind[]) => {
    if (!canPlace(entry.el, designKind, above)) ok = false;
    for (const child of entry.children ?? []) {
      if (!canContain(entry.el, child.el)) ok = false;
      visit(child, [...above, entry.el]);
    }
  };
  visit(node, ancestors);
  return ok && scopeFits(node, repeatScope(root, parentId));
}

export type DropPosition = 'before' | 'after' | 'inside';

/** Parent and index (in the tree before a move) for a drop on `targetId`. */
export function dropSpot(
  root: DesignNode,
  targetId: string,
  position: DropPosition,
): { parentId: string; index: number } | null {
  const found = findNode(root, targetId);
  if (!found) return null;
  if (position === 'inside') return { parentId: targetId, index: found.node.children?.length ?? 0 };
  if (!found.parent) return null;
  return { parentId: found.parent.id, index: found.index + (position === 'after' ? 1 : 0) };
}

/** Moves `id` to a drop spot; `null` when it is not allowed there. */
export function placeNode(
  root: DesignNode,
  designKind: SiteDesignKind,
  id: string,
  parentId: string,
  index: number,
): DesignNode | null {
  const node = findNode(root, id)?.node;
  if (!node || !canDropInto(root, designKind, node, parentId, id)) return null;
  const next = moveNode(root, id, parentId, index);
  return next === root ? null : next;
}

/** Inserts a new node; `null` when it is not allowed there. */
export function addNode(
  root: DesignNode,
  designKind: SiteDesignKind,
  node: DesignNode,
  parentId: string,
  index: number,
): DesignNode | null {
  if (!canDropInto(root, designKind, node, parentId)) return null;
  return insertNode(root, parentId, index, node);
}

/**
 * Where an insert from the palette goes: right after the selection, into it when it is the
 * root or an empty container, else after the nearest ancestor that allows it, else the
 * root's end.
 */
export function insertSpot(
  root: DesignNode,
  designKind: SiteDesignKind,
  node: DesignNode,
  selectedId: string | null,
): { parentId: string; index: number } | null {
  const found = selectedId ? findNode(root, selectedId) : null;
  if (found) {
    const into = !found.parent || (found.node.children?.length ?? 0) === 0;
    if (
      into &&
      ELEMENTS[found.node.el].container &&
      canDropInto(root, designKind, node, found.node.id)
    )
      return { parentId: found.node.id, index: found.node.children?.length ?? 0 };
    const chain = [...found.path, found.node];
    for (let depth = chain.length - 1; depth > 0; depth--) {
      const parent = chain[depth - 1] as DesignNode;
      const child = chain[depth] as DesignNode;
      if (canDropInto(root, designKind, node, parent.id)) {
        const index = (parent.children ?? []).findIndex((entry) => entry.id === child.id);
        return { parentId: parent.id, index: index + 1 };
      }
    }
  }
  return canDropInto(root, designKind, node, root.id)
    ? { parentId: root.id, index: root.children?.length ?? 0 }
    : null;
}

/** Moves a node one place up or down among its siblings. */
export function shiftNode(root: DesignNode, id: string, delta: -1 | 1): DesignNode | null {
  const found = findNode(root, id);
  if (!found?.parent) return null;
  const target = found.index + delta;
  if (target < 0 || target >= (found.parent.children?.length ?? 0)) return null;
  return moveNode(root, id, found.parent.id, delta > 0 ? target + 1 : target);
}

/** Moves a node into the end of its previous sibling. */
export function indentNode(
  root: DesignNode,
  designKind: SiteDesignKind,
  id: string,
): DesignNode | null {
  const found = findNode(root, id);
  const previous = found?.parent?.children?.[found.index - 1];
  if (!previous || !ELEMENTS[previous.el].container) return null;
  return placeNode(root, designKind, id, previous.id, previous.children?.length ?? 0);
}

/** Moves a node out of its parent, right after it. */
export function outdentNode(
  root: DesignNode,
  designKind: SiteDesignKind,
  id: string,
): DesignNode | null {
  const found = findNode(root, id);
  const parent = found?.parent;
  if (!parent) return null;
  const above = findNode(root, parent.id);
  if (!above?.parent) return null;
  return placeNode(root, designKind, id, above.parent.id, above.index + 1);
}

/** Sets or clears the name an editor gave a node. */
export function renameNode(root: DesignNode, id: string, label: string): DesignNode {
  return updateNode(root, id, (node) => {
    const props = { ...(node.props ?? {}) };
    if (label.trim()) props[LABEL_PROP] = label.trim().slice(0, 100);
    else delete props[LABEL_PROP];
    const next: DesignNode = { ...node, props };
    if (Object.keys(props).length === 0) delete next.props;
    return next;
  });
}

/** The node with one prop set, or dropped while empty; without `props` when none are left. */
export function withProp(node: DesignNode, key: string, value: unknown): DesignNode {
  const props = { ...(node.props ?? {}) };
  if (value === undefined || value === '' || value === null) delete props[key];
  else props[key] = value;
  const next: DesignNode = { ...node, props };
  if (Object.keys(props).length === 0) delete next.props;
  return next;
}

const text = (locale: string, value: string) => ({ [locale]: value });

/**
 * A new element with sensible defaults. `binding` is used by elements that show a field;
 * data elements need one.
 */
export function createNode(
  kind: ElementKind,
  id: string,
  options: { locale: string; binding?: BindingOption | null },
): DesignNode {
  const { locale, binding } = options;
  const node: DesignNode = { id, el: kind };
  if (binding) {
    const format = defaultFormat(binding.field, binding.item);
    node.bind = format ? { field: binding.value, format } : { field: binding.value };
  }
  switch (kind) {
    case 'box':
    case 'section':
      node.children = [];
      break;
    case 'stack':
      node.children = [];
      node.style = { base: { gap: 'space:4' } };
      break;
    case 'grid':
      node.children = [];
      node.style = { base: { columns: 2, gap: 'space:4' }, mobile: { columns: 1 } };
      break;
    case 'repeat':
      node.children = [];
      node.style = { base: { gap: 'space:4' } };
      break;
    case 'text':
      if (!binding) node.props = { text: text(locale, 'Text') };
      break;
    case 'heading':
      node.props = { level: 2, ...(binding ? {} : { text: text(locale, 'Heading') }) };
      break;
    case 'button':
      node.props = { variant: 'primary', ...(binding ? {} : { text: text(locale, 'Button') }) };
      node.style = { base: { alignSelf: 'start' } };
      break;
    case 'link':
      if (!binding) node.props = { text: text(locale, 'Link') };
      break;
    case 'image':
      node.style = { base: { width: '100%' } };
      break;
    case 'icon':
      node.props = { name: 'star' };
      break;
    case 'embed':
      node.props = { provider: 'youtube' };
      break;
  }
  return node;
}

/** Elements that show nothing without a field get the first one that fits. */
export function wantsBinding(kind: ElementKind): boolean {
  return ELEMENTS[kind].requiresBind === true || ['image', 'video', 'richtext'].includes(kind);
}

/** Renames ids in `taken`: `x`, else `x-2`, `x-3`, ...; `taken` grows. */
function withFreeIds(node: DesignNode, taken: Set<string>): DesignNode {
  walkNodes(node, ({ node: entry }) => {
    let id = entry.id;
    for (let n = 2; taken.has(id); n++) id = `${entry.id}-${n}`.slice(0, 40);
    entry.id = id;
    taken.add(id);
  });
  return node;
}

/** The generated element for a top-level field, with ids not in `taken`. */
export function nodeForField(field: DesignField, taken: Set<string>): DesignNode | null {
  const fields = [{ ...field, required: false }] as unknown as DesignSourceType['fields'];
  const generated = generateBlockDesign({ fields }).variants.default?.root.children?.[0];
  return generated ? withFreeIds(generated, taken) : null;
}

/** The first field an element could show at a spot, for inserts from the palette. */
export function firstBinding(
  root: DesignNode,
  fields: readonly DesignField[],
  kind: ElementKind,
  parentId: string,
): BindingOption | null {
  const options = bindingOptions(fields, kind, repeatScope(root, parentId));
  return options[0] ?? null;
}

/** The node a validation path inside a tree points at, e.g. `root.children.2.style.base`. */
export function nodeAtPath(root: DesignNode, path: string): string | null {
  const segments = path.split('.');
  if (segments[0] !== 'root') return null;
  let node = root;
  for (let index = 1; segments[index] === 'children'; index += 2) {
    const child = node.children?.[Number(segments[index + 1])];
    if (!child) break;
    node = child;
  }
  return node.id;
}
