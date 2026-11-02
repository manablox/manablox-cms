import type { ContentTypeDefinition } from '@manablox/core';
import type { BlockInstanceStyle } from '@manablox/site';
import type { SiteLink } from './site-links';

/** Every block override in a document's fields, nested blocks included. */
export function instanceStylesOf(value: unknown): BlockInstanceStyle[] {
  const out: BlockInstanceStyle[] = [];
  const walk = (entry: unknown, depth: number): void => {
    if (depth > 64 || entry === null || typeof entry !== 'object') return;
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, depth + 1);
      return;
    }
    const record = entry as Record<string, unknown>;
    const design = isRecord(record.ext) ? record.ext.website : undefined;
    if (typeof record.blockId === 'string' && isRecord(design)) {
      const style = design.style;
      if (isRecord(style) && Object.keys(style).length) out.push(style as BlockInstanceStyle);
    }
    for (const [key, child] of Object.entries(record)) if (key !== 'ext') walk(child, depth + 1);
  };
  walk(value, 0);
  return out;
}

type FieldOwner = Pick<ContentTypeDefinition, 'fields'>;

/**
 * Asset ids a render needs: asset fields of the document and its blocks and repeater items,
 * every `assetId` in the designs and overrides, the site's favicon and share image.
 */
export function canvasAssetIds(
  fields: Record<string, unknown>,
  type: FieldOwner | null,
  typeById: (id: string) => FieldOwner | null,
  designs: readonly unknown[] = [],
): string[] {
  const ids = new Set<string>();
  const addIds = (value: unknown) => {
    for (const id of Array.isArray(value) ? value : [value])
      if (typeof id === 'string' && id) ids.add(id);
  };
  const walkFields = (owner: FieldOwner, values: Record<string, unknown>, depth: number) => {
    if (depth > 32) return;
    for (const field of owner.fields) {
      const value = values[field.name];
      if (field.type === 'asset') addIds(value);
      else if (field.type === 'repeater') {
        const sub = { fields: (field.settings.fields ?? []) as FieldOwner['fields'] };
        for (const item of Array.isArray(value) ? value : [])
          if (isRecord(item) && isRecord(item.fields)) walkFields(sub, item.fields, depth + 1);
      } else {
        const list = isRecord(value) && Array.isArray(value.blocks) ? value.blocks : [value];
        for (const entry of list) {
          if (!isRecord(entry) || typeof entry.type !== 'string' || !isRecord(entry.fields))
            continue;
          const blockType = typeById(entry.type);
          if (blockType) walkFields(blockType, entry.fields, depth + 1);
        }
      }
    }
  };
  if (type) walkFields(type, fields, 0);

  const walkIds = (value: unknown, depth: number): void => {
    if (depth > 64 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walkIds(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'assetId' && typeof entry === 'string' && entry) ids.add(entry);
      else walkIds(entry, depth + 1);
    }
  };
  walkIds(fields, 0);
  for (const design of designs) walkIds(design, 0);
  for (const design of designs) {
    if (!isRecord(design)) continue;
    if (typeof design.favicon === 'string' && design.favicon) ids.add(design.favicon);
    const meta = design.meta;
    if (isRecord(meta) && typeof meta.ogImage === 'string' && meta.ogImage) ids.add(meta.ogImage);
  }
  return [...ids].sort();
}

/** A related document as the canvas links it; designs may show its fields. */
export interface CanvasLinkTarget {
  id: string;
  title: string;
  permalink: string | null;
  locale: string;
  fields?: Record<string, unknown>;
}

/** Walks the fields of a document, its blocks and repeater items; `visit` may replace a value. */
function mapFields(
  owner: FieldOwner,
  values: Record<string, unknown>,
  typeById: (id: string) => FieldOwner | null,
  visit: (field: FieldOwner['fields'][number], value: unknown) => unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > 32) return values;
  const out: Record<string, unknown> = { ...values };
  for (const field of owner.fields) {
    if (!(field.name in values)) continue;
    const value = values[field.name];
    if (field.type === 'repeater') {
      const sub = { fields: (field.settings.fields ?? []) as FieldOwner['fields'] };
      if (Array.isArray(value))
        out[field.name] = value.map((item) =>
          isRecord(item) && isRecord(item.fields)
            ? { ...item, fields: mapFields(sub, item.fields, typeById, visit, depth + 1) }
            : item,
        );
      continue;
    }
    const block = (entry: unknown): unknown => {
      if (!isRecord(entry) || typeof entry.type !== 'string' || !isRecord(entry.fields))
        return entry;
      const blockType = typeById(entry.type);
      return blockType
        ? { ...entry, fields: mapFields(blockType, entry.fields, typeById, visit, depth + 1) }
        : entry;
    };
    if (isRecord(value) && Array.isArray(value.blocks)) {
      out[field.name] = { ...value, blocks: value.blocks.map(block) };
      continue;
    }
    if (isRecord(value) && typeof value.blockId === 'string') {
      out[field.name] = block(value);
      continue;
    }
    out[field.name] = visit(field, value);
  }
  return out;
}

/** Ids of the documents `content` fields and internal `link` fields point at. */
export function canvasLinkIds(
  fields: Record<string, unknown>,
  type: FieldOwner | null,
  typeById: (id: string) => FieldOwner | null,
): string[] {
  const ids = new Set<string>();
  if (!type) return [];
  mapFields(type, fields, typeById, (field, value) => {
    if (field.type === 'content')
      for (const id of Array.isArray(value) ? value : [value])
        if (typeof id === 'string' && id) ids.add(id);
    if (field.type === 'link' && isRecord(value) && value.mode === 'internal') {
      if (typeof value.contentId === 'string' && value.contentId) ids.add(value.contentId);
    }
    return value;
  });
  return [...ids].sort();
}

/**
 * The draft's fields with related documents inlined as the site does, linked like the site:
 * `content` fields become `{ id, title, permalink, locale, fields }`, internal links get an
 * `href`.
 */
export function withCanvasLinks(
  fields: Record<string, unknown>,
  type: FieldOwner | null,
  typeById: (id: string) => FieldOwner | null,
  targets: ReadonlyMap<string, CanvasLinkTarget>,
  link: SiteLink,
): Record<string, unknown> {
  if (!type) return fields;
  const href = (target: CanvasLinkTarget | undefined): string | null =>
    target && target.permalink !== null ? link(target.locale, target.permalink) : null;
  return mapFields(type, fields, typeById, (field, value) => {
    if (field.type === 'content') {
      const inline = (id: unknown) => {
        const target = typeof id === 'string' ? targets.get(id) : undefined;
        return target ? { ...target, permalink: href(target) } : null;
      };
      return Array.isArray(value)
        ? value.map(inline).filter((entry) => entry !== null)
        : inline(value);
    }
    if (field.type === 'link' && isRecord(value) && value.mode === 'internal') {
      const id = typeof value.contentId === 'string' ? value.contentId : '';
      return { ...value, href: href(targets.get(id)) };
    }
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
