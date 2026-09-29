import {
  type Asset,
  type Block,
  type ContentNode,
  type FieldItem,
  isRichTextEmpty,
  richTextToHtml,
} from '@manablox/public-sdk';

/**
 * What the generated components read their fields through. A value arrives the way the
 * API serves it - a relation as an id unless the page named it in `expand`, rich text as
 * a document tree - so each helper answers one question: what is there to show? `null`,
 * or an empty list, means nothing, and the component leaves the element out.
 */

/** A scalar, or a list of them, as text. */
export function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  return String(value);
}

// One fixed locale, so the server and the browser format the same string and hydration
// agrees. Swap it for the page's locale once the site has more than one.
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** A date as `<time datetime>` wants it, and as a person reads it. */
export function date(value: unknown): { iso: string; label: string } | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return { iso: value, label: Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed) };
}

/**
 * Rich text as HTML. The SDK escapes every string and emits a fixed set of tags, which is
 * the only reason the components may set it as inner HTML. Never do that with a CMS
 * string that did not come through here.
 */
export function html(value: unknown): string | null {
  return isRichTextEmpty(value) ? null : richTextToHtml(value);
}

/** Whatever a plugin's field holds, readable. */
export function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value, null, 2);
}

/** The expanded assets of an asset field, one or several. An id alone shows nothing. */
export function assets(value: unknown): Asset[] {
  return list(value).filter(
    (entry): entry is Asset =>
      isRecord(entry) && typeof entry.url === 'string' && typeof entry.mimeType === 'string',
  );
}

/** The expanded documents of a content relation, one or several. */
export function documents(value: unknown): ContentNode[] {
  return list(value).filter(
    (entry): entry is ContentNode =>
      isRecord(entry) && typeof entry.id === 'string' && typeof entry.title === 'string',
  );
}

/** Where a document lives on this site. */
export function href(node: ContentNode): string {
  return `/${node.permalink ?? ''}`;
}

/** The names of the expanded users of a user field. */
export function users(value: unknown): string | null {
  const names = list(value)
    .map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name : null))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : null;
}

/**
 * A link field. Delivery resolves an internal link to a permalink in `href`; the document
 * the visual editor sends has only the address it was given, so `url` is the fallback.
 */
export function link(value: unknown): { href: string; label: string; newTab: boolean } | null {
  if (!isRecord(value)) return null;
  const target =
    (typeof value.href === 'string' && value.href) ||
    (typeof value.url === 'string' && value.url) ||
    null;
  if (!target) return null;
  const content = isRecord(value.content) ? value.content : null;
  const label =
    (typeof value.label === 'string' && value.label) ||
    (content && typeof content.title === 'string' && content.title) ||
    target;
  return { href: target, label, newTab: value.target === '_blank' };
}

/**
 * A single block field's block, or `null`. The editor sends the block itself; delivery
 * wraps it the way it wraps a list, as `{ grid, blocks: [block] }`. Either reads here.
 */
export function blockOf(value: unknown): Block | null {
  const candidate = isRecord(value) && Array.isArray(value.blocks) ? value.blocks[0] : value;
  return isRecord(candidate) && typeof candidate.blockId === 'string' ? (candidate as Block) : null;
}

/** A repeater's items, each with its values in `fields` by sub-field name. */
export function items(value: unknown): FieldItem[] {
  return list(value).filter(
    (entry): entry is FieldItem =>
      isRecord(entry) && typeof entry.itemId === 'string' && isRecord(entry.fields),
  );
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
