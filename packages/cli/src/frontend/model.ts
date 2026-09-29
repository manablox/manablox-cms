import type { ContentModelField, ContentModelType } from '@manablox/public-sdk';

/** A content model reduced to what generated components need, from either API. */

export type FieldRender =
  | 'text'
  | 'date'
  | 'richtext'
  | 'asset'
  | 'content'
  | 'user'
  | 'link'
  | 'blocks'
  | 'block'
  | 'items'
  | 'json';

export interface ModelField {
  name: string;
  label: string;
  render: FieldRender;
  /** A multi-value relation or select. */
  list: boolean;
  /** What each item holds, for `items`. */
  fields?: ModelField[];
}

export interface ModelType {
  /** Machine name; delivered as `type`. */
  name: string;
  label: string;
  kind: 'content' | 'block';
  fields: ModelField[];
}

export interface RenderModel {
  types: ModelType[];
}

/** Built-in field types; plugin types fall back. */
const RENDERS: Record<string, FieldRender> = {
  string: 'text',
  number: 'text',
  boolean: 'text',
  select: 'text',
  databag: 'text',
  date: 'date',
  richtext: 'richtext',
  asset: 'asset',
  content: 'content',
  user: 'user',
  link: 'link',
  blocks: 'blocks',
  // Delivers the referenced template's blocks.
  template: 'blocks',
  block: 'block',
  repeater: 'items',
};

/** Built-in types that get no component. */
const SYSTEM_TYPES = new Set(['folder', 'template']);

/** A content type from the management API's `contentTypes.list`. */
export interface ManagementContentType {
  name: string;
  label?: string;
  kind: 'content' | 'block' | 'data';
  isSystem?: boolean;
  fields: ManagementField[];
}

interface ManagementField {
  name: string;
  label?: string;
  type: string;
  settings?: Record<string, unknown>;
  readRoles?: string[];
}

/** Databags have no page, and system types are built in. */
function isRendered<T extends { name: string; kind: 'content' | 'block' | 'data' }>(
  type: T,
): type is T & { kind: 'content' | 'block' } {
  return type.kind !== 'data' && !SYSTEM_TYPES.has(type.name);
}

export function modelFromManagement(types: ManagementContentType[]): RenderModel {
  return {
    types: sortTypes(
      types
        .filter(isRendered)
        .filter((type) => !type.isSystem)
        .map((type) => ({
          name: type.name,
          label: type.label || humanise(type.name),
          kind: type.kind,
          fields: type.fields
            // Role-gated fields are never delivered.
            .filter((field) => !field.readRoles?.length)
            .map(managementField),
        })),
    ),
  };
}

function managementField(field: ManagementField): ModelField {
  const render = RENDERS[field.type] ?? 'json';
  if (render !== 'items') {
    return {
      name: field.name,
      label: field.label || humanise(field.name),
      render,
      list: field.settings?.multiple === true,
    };
  }
  const raw = Array.isArray(field.settings?.fields) ? field.settings.fields : [];
  return {
    name: field.name,
    label: field.label || humanise(field.name),
    render,
    list: false,
    fields: raw
      .filter(
        (sub): sub is ManagementField =>
          typeof sub?.name === 'string' && typeof sub?.type === 'string',
      )
      .map(managementField),
  };
}

export function modelFromDelivery(types: ContentModelType[]): RenderModel {
  return {
    types: sortTypes(
      types.filter(isRendered).map((type) => ({
        name: type.name,
        label: type.label || humanise(type.name),
        kind: type.kind,
        fields: type.fields.map(deliveryField),
      })),
    ),
  };
}

function deliveryField(field: ContentModelField): ModelField {
  const render = RENDERS[field.type] ?? deliveryRender(field);
  return {
    name: field.name,
    label: humanise(field.name),
    render,
    // Block and item lists are lists by kind.
    list: render === 'blocks' || render === 'block' || render === 'items' ? false : field.list,
    ...(render === 'items' ? { fields: (field.fields ?? []).map(deliveryField) } : {}),
  };
}

/** Infers a plugin field type from its delivery GraphQL shape. */
function deliveryRender(field: ContentModelField): FieldRender {
  switch (field.kind) {
    case 'ref':
      return field.target ?? 'content';
    case 'block':
      return field.list ? 'blocks' : 'block';
    case 'blockRef':
      return 'blocks';
    case 'link':
      return 'link';
    case 'items':
      return 'items';
    case 'scalar':
      if (field.scalar === 'DateTime') return 'date';
      if (field.scalar === 'JSON') return 'json';
      return 'text';
  }
}

/** Content types first, then block types, each by name. */
function sortTypes(types: ModelType[]): ModelType[] {
  return [...types].sort((a, b) =>
    a.kind === b.kind ? (a.name < b.name ? -1 : 1) : a.kind === 'content' ? -1 : 1,
  );
}

/** Resolves `--types`; an unknown name errors with the available ones. */
export function selectTypes(model: RenderModel, wanted: string[] | 'all'): RenderModel {
  if (wanted === 'all') return model;
  const known = new Set(model.types.map((type) => type.name));
  const unknown = wanted.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `--types: the space has no type ${unknown.map((name) => `'${name}'`).join(', ')}; ` +
        `it has ${model.types.map((type) => type.name).join(', ') || 'none'}`,
    );
  }
  const picked = new Set(wanted);
  return { types: model.types.filter((type) => picked.has(type.name)) };
}

/** `all`, or a comma separated list of type names. */
export function parseTypes(raw: string): string[] | 'all' {
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error("--types takes 'all' or a comma separated list");
  return names.includes('all') ? 'all' : names;
}

/** Relation fields to `expand` so they arrive as objects; delivery matches names at any depth. */
export function expandFor(model: RenderModel): string[] {
  const names = new Set<string>();
  for (const type of model.types) {
    for (const field of type.fields) {
      if (field.render === 'asset' || field.render === 'content' || field.render === 'user') {
        names.add(field.name);
      }
    }
  }
  return [...names].sort();
}

/** `hero_image` -> `Hero image`. */
function humanise(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
