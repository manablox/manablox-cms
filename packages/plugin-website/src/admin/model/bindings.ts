import type { FieldDefinition } from '@manablox/core';
import {
  type BindingFormat,
  type DesignNode,
  type ElementKind,
  findNode,
  type SiteDesignKind,
  subFieldsOf,
} from '@manablox/site';

/** What the designer reads of a field. */
export type DesignField = Pick<FieldDefinition, 'id' | 'name' | 'type' | 'settings'> & {
  label?: string | undefined;
  /** A `content` field's related documents' fields, bound by name inside a `repeat`. */
  related?: readonly DesignField[] | undefined;
};

/** Fields with the fields of the types each `content` field may point at. */
export function withRelated(
  fields: readonly DesignField[],
  typeById: (id: string) => { fields: readonly DesignField[] } | null | undefined,
): DesignField[] {
  return fields.map((field) => {
    if (field.type !== 'content') return field;
    const ids = Array.isArray(field.settings?.types) ? (field.settings.types as unknown[]) : [];
    const related = new Map<string, DesignField>();
    for (const id of ids) {
      for (const entry of (typeof id === 'string' ? typeById(id)?.fields : undefined) ?? [])
        if (!related.has(entry.name))
          related.set(entry.name, {
            id: entry.name,
            name: entry.name,
            label: entry.label,
            type: entry.type,
            settings: entry.settings,
          });
    }
    return related.size ? { ...field, related: [...related.values()] } : field;
  });
}

/** Fields one level down a path: a repeater's sub-fields or a relation's related fields. */
const childFields = (field: DesignField): readonly DesignField[] =>
  field.type === 'repeater' ? subFieldsOf(field) : (field.related ?? []);

/** One choice of the binding picker. */
export interface BindingOption {
  /** The binding path, e.g. `title`, `items.name` or `gallery.$item`. */
  value: string;
  label: string;
  /** The field's type, shown beside the label. */
  hint: string;
  field: DesignField;
  /** The path shows one entry of a list, inside a `repeat`. */
  item: boolean;
}

const isList = (field: DesignField): boolean => field.settings?.multiple === true;

const NO_TEXT = new Set(['repeater', 'blocks', 'block', 'template', 'asset', 'databag']);

/** Which bound values an element can show; `item` is one entry of a list. */
function fits(el: ElementKind, field: DesignField, item: boolean): boolean {
  const type = field.type;
  const list = isList(field) && !item;
  switch (el) {
    case 'text':
    case 'heading':
      return !NO_TEXT.has(type);
    case 'richtext':
      return (type === 'richtext' || type === 'string') && !list;
    case 'image':
    case 'video':
      return type === 'asset';
    case 'link':
    case 'button':
      return type === 'link' || type === 'content' || type === 'asset' || type === 'string';
    case 'repeat':
      return !item && (type === 'repeater' || isList(field));
    case 'blocks':
      return type === 'blocks';
    case 'block':
      return type === 'block' || type === 'blocks';
    case 'template':
      return type === 'template';
    case 'form':
      return type === 'databag' && !list;
    default:
      return false;
  }
}

/** Whether an element kind takes a binding at all. */
export function bindable(el: ElementKind): boolean {
  return [
    'text',
    'heading',
    'richtext',
    'image',
    'video',
    'link',
    'button',
    'repeat',
    'blocks',
    'block',
    'template',
  ].includes(el);
}

const labelOf = (field: DesignField) => field.label || field.name;

const meta = (id: string, label: string, type: string, settings = {}): DesignField => ({
  id,
  name: id,
  label,
  type,
  settings,
});

/** Document meta, bound as `$title`, ...; pages and layouts. */
const DOCUMENT_META: readonly DesignField[] = [
  meta('$title', 'Page title', 'string'),
  meta('$permalink', 'Page address', 'string'),
  meta('$publishedAt', 'Published on', 'date', { mode: 'datetime' }),
  meta('$author', 'Author', 'string'),
];

/** Site meta; layouts only. */
const SITE_META: readonly DesignField[] = [
  meta('$site.name', 'Site name', 'string'),
  meta('$site.logo', 'Site logo', 'asset', { accept: ['image/*'] }),
];

/** Meta values a design kind may bind, listed before the type's own fields. */
export function metaFields(kind: SiteDesignKind): DesignField[] {
  if (kind === 'page') return [...DOCUMENT_META];
  if (kind === 'layout') return [...SITE_META, ...DOCUMENT_META];
  return [];
}

/** The field a binding path points at, following repeaters; `$item` is the list itself. */
export function fieldAtPath(
  fields: readonly DesignField[],
  path: string,
): { field: DesignField; item: boolean } | null {
  if (path.startsWith('$')) {
    const found = fields.find((field) => field.id === path);
    return found ? { field: found, item: false } : null;
  }
  let current: readonly DesignField[] = fields;
  let found: DesignField | null = null;
  const segments = path.split('.');
  for (const [index, segment] of segments.entries()) {
    if (segment === '$item')
      return found && index === segments.length - 1 ? { field: found, item: true } : null;
    found = current.find((field) => field.id === segment) ?? null;
    if (!found) return null;
    current = childFields(found);
  }
  return found ? { field: found, item: false } : null;
}

/** A readable name for a binding path, e.g. `Team > Name`. */
export function bindingLabel(fields: readonly DesignField[], path: string): string {
  if (path.startsWith('$')) {
    const found = fields.find((field) => field.id === path);
    return found ? labelOf(found) : path;
  }
  const parts: string[] = [];
  let current: readonly DesignField[] = fields;
  for (const segment of path.split('.')) {
    if (segment === '$item') {
      parts.push('each entry');
      break;
    }
    const field = current.find((entry) => entry.id === segment);
    if (!field) return path;
    parts.push(labelOf(field));
    current = childFields(field);
  }
  return parts.join(' > ');
}

/** Binding paths of the `repeat` elements around a child of `parentId` (itself included). */
export function repeatScope(root: DesignNode, parentId: string): string[] {
  const found = findNode(root, parentId);
  if (!found) return [];
  return [...found.path, found.node]
    .filter((node) => node.el === 'repeat' && typeof node.bind?.field === 'string')
    .map((node) => node.bind?.field as string);
}

/** Repeats around a node, not counting the node itself. */
export function repeatsAround(root: DesignNode, id: string): string[] {
  const found = findNode(root, id);
  if (!found) return [];
  return found.path
    .filter((node) => node.el === 'repeat' && typeof node.bind?.field === 'string')
    .map((node) => node.bind?.field as string);
}

/**
 * Fields an element may bind to where it sits: top-level fields, the sub-fields of each
 * repeater a surrounding `repeat` walks, and the entry of each list a `repeat` walks.
 * Without `el`, every path is offered (for visibility conditions).
 */
export function bindingOptions(
  fields: readonly DesignField[],
  el: ElementKind | null,
  repeats: readonly string[],
): BindingOption[] {
  const out: BindingOption[] = [];
  const add = (value: string, field: DesignField, item: boolean, label: string) => {
    if (el && !fits(el, field, item)) return;
    // A repeat inside the repeat of the same path would walk it again.
    if (el === 'repeat' && repeats.includes(value)) return;
    out.push({ value, label, hint: item ? `${field.type} entry` : field.type, field, item });
  };
  for (const field of fields) add(field.id, field, false, labelOf(field));
  for (const path of repeats) {
    const target = fieldAtPath(fields, path);
    if (!target || target.item || path.split('.').length >= 4) continue;
    const base = bindingLabel(fields, path);
    if (target.field.type === 'repeater') {
      for (const sub of subFieldsOf(target.field))
        add(`${path}.${sub.id}`, sub, false, `${base} > ${labelOf(sub)}`);
    } else if (isList(target.field)) {
      add(`${path}.$item`, target.field, true, `${base} > each entry`);
      for (const sub of target.field.related ?? [])
        add(`${path}.${sub.id}`, sub, false, `${base} > ${labelOf(sub)}`);
    }
  }
  return out;
}

/** Formats that suit a bound field, the first is the default. */
export function formatKinds(field: DesignField, item: boolean): BindingFormat['type'][] {
  switch (field.type) {
    case 'date':
      return ['date'];
    case 'number':
      return ['number'];
    case 'boolean':
      return ['boolean'];
    case 'select':
    case 'content':
    case 'user':
      return isList(field) && !item ? ['list'] : [];
    case 'string':
    case 'richtext':
      return ['excerpt'];
    default:
      return [];
  }
}

/** The format a new binding to `field` starts with, as the generator picks it. */
export function defaultFormat(field: DesignField, item: boolean): BindingFormat | undefined {
  switch (field.type) {
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return field.settings?.mode === 'date'
        ? { type: 'date', style: 'long' }
        : { type: 'date', style: 'long', time: true };
    case 'select':
      return isList(field) && !item ? { type: 'list' } : undefined;
    default:
      return undefined;
  }
}

/** The element that shows a field best, as the generator picks it. */
export function elementForField(field: DesignField): ElementKind {
  switch (field.type) {
    case 'richtext':
      return 'richtext';
    case 'asset': {
      const accept = Array.isArray(field.settings?.accept)
        ? (field.settings.accept as unknown[]).filter((entry) => typeof entry === 'string')
        : [];
      const video = accept.length > 0 && accept.every((entry) => entry.startsWith('video/'));
      if (isList(field)) return 'repeat';
      return video ? 'video' : 'image';
    }
    case 'link':
      return 'button';
    case 'content':
    case 'user':
      return isList(field) ? 'repeat' : field.type === 'content' ? 'link' : 'text';
    case 'repeater':
      return 'repeat';
    case 'blocks':
    case 'block':
    case 'template':
      return field.type;
    case 'databag':
      return 'form';
    default:
      return 'text';
  }
}
