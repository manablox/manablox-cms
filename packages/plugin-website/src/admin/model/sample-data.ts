import type { BlockValue } from '@manablox/core';
import { type SiteAsset, subFieldsOf } from '@manablox/site';
import sampleSvg from '../design-sample.svg?raw';
import type { DesignField } from './bindings';
import { mediaPath } from './canvas';

/** Asset id of the placeholder picture sample values use. */
export const SAMPLE_IMAGE_ID = 'mb-sample-image';
/** The placeholder picture, inlined so a canvas on another origin can show it. */
const SAMPLE_IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(sampleSvg)}`;

const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(
    ' ',
  );

/** `count` words of placeholder text, starting at `offset`, as a sentence. */
function lorem(count: number, offset = 0): string {
  const words = Array.from({ length: count }, (_, index) => WORDS[(offset + index) % WORDS.length]);
  const text = words.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const sentence = (count: number, offset: number) => `${lorem(count, offset)}.`;

function richText(offset: number) {
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  return {
    type: 'doc',
    content: [
      paragraph(`${sentence(18, offset)} ${sentence(12, offset + 7)}`),
      paragraph(sentence(14, offset + 3)),
    ],
  };
}

interface SampleContext {
  /** A heading-like string is still free. */
  title: boolean;
  offset: number;
  depth: number;
  /** Databag fields without allowed types show this one. */
  databag: string | null;
}

function sampleOne(field: DesignField, context: SampleContext): unknown {
  const settings = field.settings ?? {};
  context.offset += 5;
  const offset = context.offset;
  switch (field.type) {
    case 'string': {
      if (settings.editor === 'code') return 'const answer = 42;';
      if (settings.editor === 'textarea')
        return `${sentence(16, offset)} ${sentence(10, offset + 4)}`;
      if (/e-?mail/i.test(field.name)) return 'hello@example.com';
      if (context.title) {
        context.title = false;
        return lorem(4, offset);
      }
      return sentence(9, offset);
    }
    case 'richtext':
      return richText(offset);
    case 'number':
      return 42;
    case 'boolean':
      return true;
    case 'date':
      return settings.mode === 'date' ? '2026-03-14' : '2026-03-14T10:30:00.000Z';
    case 'select': {
      const options = Array.isArray(settings.options) ? settings.options : [];
      const values = options
        .map((option) =>
          option && typeof option === 'object' ? (option as { value?: unknown }).value : null,
        )
        .filter((value): value is string => typeof value === 'string');
      return values[0] ?? null;
    }
    case 'link':
      return {
        mode: 'external',
        url: 'https://example.com',
        href: 'https://example.com',
        target: '_self',
        label: 'Learn more',
      };
    case 'asset':
      return SAMPLE_IMAGE_ID;
    case 'content': {
      const related: SampleContext = { ...context, title: false, depth: context.depth + 1 };
      const fields =
        field.related && context.depth < 2
          ? Object.fromEntries(field.related.map((sub) => [sub.name, sampleOne(sub, related)]))
          : undefined;
      return {
        id: 'sample',
        title: lorem(3, offset),
        permalink: '/',
        ...(fields ? { fields } : {}),
      };
    }
    case 'user':
      return { name: 'Alex Morgan' };
    case 'repeater': {
      if (context.depth >= 2) return [];
      const subFields = subFieldsOf(field);
      return Array.from({ length: 3 }, () => {
        const item: SampleContext = {
          title: true,
          offset: context.offset,
          depth: context.depth + 1,
          databag: context.databag,
        };
        context.offset += 11;
        return Object.fromEntries(subFields.map((sub) => [sub.name, sampleOne(sub, item)]));
      });
    }
    case 'blocks':
      return { blocks: [] };
    case 'block':
    case 'template':
      return null;
    case 'databag': {
      const types = Array.isArray(settings.types) ? settings.types : [];
      return typeof types[0] === 'string' ? types[0] : context.databag;
    }
    default:
      return sentence(6, offset);
  }
}

/** A block from a real document, as the canvas's sample. */
export interface SampleChoice {
  documentId: string;
  title: string;
  block: BlockValue;
}

/**
 * Placeholder values for a type's fields, by field name, as a block instance stores them;
 * databag fields show `databag`.
 */
export function sampleFields(
  fields: readonly DesignField[],
  databag: string | null = null,
): Record<string, unknown> {
  const context: SampleContext = { title: true, offset: 0, depth: 0, databag };
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = sampleOne(field, context);
    const list =
      field.settings?.multiple === true && field.type !== 'select' && field.type !== 'repeater';
    if (list) out[field.name] = [value, sampleOne(field, context), sampleOne(field, context)];
    else if (field.type === 'select' && field.settings?.multiple === true)
      out[field.name] = value === null ? [] : [value];
    else out[field.name] = value;
  }
  return out;
}

/** The placeholder picture as a render input asset. */
export function sampleAssets(): Record<string, SiteAsset> {
  return {
    [SAMPLE_IMAGE_ID]: {
      url: SAMPLE_IMAGE_URL,
      width: 1200,
      height: 800,
      alt: 'Sample picture',
      mimeType: 'image/svg+xml',
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every stored block of `typeId` in a document's fields, nested blocks included. */
export function findBlockInstances(value: unknown, typeId: string, limit = 50): BlockValue[] {
  const found: BlockValue[] = [];
  const visit = (entry: unknown, depth: number) => {
    if (found.length >= limit || depth > 12) return;
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, depth + 1);
      return;
    }
    if (!isRecord(entry)) return;
    if (typeof entry.blockId === 'string' && typeof entry.type === 'string') {
      if (entry.type === typeId && isRecord(entry.fields))
        found.push(entry as unknown as BlockValue);
    }
    for (const child of Object.values(entry)) visit(child, depth + 1);
  };
  visit(value, 0);
  return found;
}

/** Asset ids a block's stored values hold, through repeaters. */
export function assetIdsIn(fields: readonly DesignField[], values: unknown): string[] {
  const ids = new Set<string>();
  const visit = (defs: readonly DesignField[], item: unknown) => {
    if (!isRecord(item)) return;
    for (const def of defs) {
      const value = item[def.name] ?? item[def.id];
      if (def.type === 'asset') {
        for (const id of Array.isArray(value) ? value : [value])
          if (typeof id === 'string' && id) ids.add(id);
      } else if (def.type === 'repeater' && Array.isArray(value)) {
        for (const entry of value) visit(subFieldsOf(def), entry);
      }
    }
  };
  visit(fields, values);
  return [...ids];
}

/** Render input assets for stored asset ids, served by the admin's media route. */
export function mediaAssets(ids: readonly string[], origin: string): Record<string, SiteAsset> {
  return Object.fromEntries(ids.map((id) => [id, { url: `${origin}${mediaPath(id)}` }]));
}
