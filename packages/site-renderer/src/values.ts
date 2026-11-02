import { isRichTextNode, richTextToText } from '@manablox/public-sdk';
import type { BindingFormat, SiteAsset } from '@manablox/site';
import type { RenderContext } from './context.js';
import type { FieldDef } from './types.js';
import { isRecord, localize, safeHref } from './util.js';

/** An asset as the renderer uses it: the delivered shape or a `SiteAsset`. */
export interface RenderAsset {
  url: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  alt?: string | null | undefined;
  title?: string | null | undefined;
  mimeType?: string | null | undefined;
  variants?: Record<string, string> | undefined;
  focalPoint?: { x: number; y: number } | null | undefined;
}

export interface RenderLink {
  href: string;
  target: '_self' | '_blank';
  label: string;
}

/** An asset from a delivered object, an asset id known to the input, or a list's first. */
export function asAsset(value: unknown, ctx: RenderContext): RenderAsset | null {
  if (Array.isArray(value)) return value.length ? asAsset(value[0], ctx) : null;
  if (typeof value === 'string') {
    const known = ctx.input.assets?.[value] as SiteAsset | undefined;
    return known && typeof known.url === 'string' ? known : null;
  }
  if (isRecord(value) && typeof value.url === 'string' && !('href' in value)) {
    const url = safeHref(value.url);
    return url ? ({ ...value, url } as RenderAsset) : null;
  }
  return null;
}

/** A link from a link field, a related document, an asset, or a plain address. */
export function asLink(value: unknown, ctx: RenderContext): RenderLink | null {
  if (Array.isArray(value)) return value.length ? asLink(value[0], ctx) : null;
  if (typeof value === 'string') {
    const href = safeHref(value);
    if (href) return { href, target: '_self', label: '' };
    const asset = asAsset(value, ctx);
    return asset ? { href: asset.url, target: '_self', label: asset.title ?? '' } : null;
  }
  if (!isRecord(value)) return null;
  // Link field: `href` is resolved by delivery.
  if ('href' in value || 'mode' in value) {
    const href = safeHref(value.href ?? (value.mode === 'external' ? value.url : null));
    if (!href) return null;
    return {
      href,
      target: value.target === '_blank' ? '_blank' : '_self',
      label: typeof value.label === 'string' ? value.label : '',
    };
  }
  // Related document.
  if ('permalink' in value) {
    const href = safeHref(value.permalink);
    return href
      ? { href, target: '_self', label: typeof value.title === 'string' ? value.title : '' }
      : null;
  }
  const asset = asAsset(value, ctx);
  if (asset)
    return {
      href: asset.url,
      target: '_self',
      label: asset.title ?? (typeof value.filename === 'string' ? value.filename : ''),
    };
  return null;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) {
    if (Array.isArray(value.blocks)) return value.blocks.length === 0;
    if (isRichTextNode(value) && value.type === 'doc') return richTextToText(value) === '';
  }
  return false;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(
  value: unknown,
  format: Extract<BindingFormat, { type: 'date' }> | undefined,
  locale: string,
  withTime: boolean,
): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  const time = format?.time ?? (withTime && !(typeof value === 'string' && DATE_ONLY.test(value)));
  try {
    // UTC, so the server and the canvas show the same day.
    return new Intl.DateTimeFormat(locale, {
      dateStyle: format?.style ?? 'medium',
      ...(time ? { timeStyle: 'short' } : {}),
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, time ? 16 : 10);
  }
}

function formatNumber(
  value: unknown,
  format: Extract<BindingFormat, { type: 'number' }> | undefined,
  locale: string,
): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === '' || !Number.isFinite(number)) return '';
  const options: Intl.NumberFormatOptions =
    format?.grouping === false ? { useGrouping: false } : {};
  if (format?.style === 'percent') options.style = 'percent';
  if (format?.style === 'currency' && format.currency) {
    options.style = 'currency';
    options.currency = format.currency;
  }
  if (format?.decimals !== undefined) {
    options.minimumFractionDigits = format.decimals;
    options.maximumFractionDigits = format.decimals;
  }
  try {
    return new Intl.NumberFormat(locale, options).format(number);
  } catch {
    return String(number);
  }
}

function optionLabel(def: FieldDef | null, value: string): string {
  const options = def?.settings?.options;
  if (!Array.isArray(options)) return value;
  const option = options.find((entry) => isRecord(entry) && entry.value === value);
  return isRecord(option) && typeof option.label === 'string' && option.label
    ? option.label
    : value;
}

/** Plain text of one value, by what it looks like and its field type. */
function textOfOne(value: unknown, def: FieldDef | null, ctx: RenderContext): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    if (def?.type === 'date')
      return formatDate(value, undefined, ctx.locale, def.settings?.mode !== 'date');
    if (def?.type === 'select') return optionLabel(def, value);
    // Unexpanded relations are ids, which mean nothing to a reader.
    if (def?.type === 'asset') return ctx.input.assets?.[value]?.alt ?? '';
    if (def?.type === 'content' || def?.type === 'user') return '';
    return value;
  }
  if (typeof value === 'number') return formatNumber(value, undefined, ctx.locale);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value
      .map((entry) => textOfOne(entry, def, ctx))
      .filter(Boolean)
      .join(', ');
  if (isRecord(value)) {
    // A related document has a `type` too, so its title goes first.
    if (typeof value.title === 'string' && value.title) return value.title;
    if (isRichTextNode(value)) return richTextToText(value);
    if (typeof value.name === 'string' && value.name) return value.name;
    if (typeof value.label === 'string' && value.label) return value.label;
    if (typeof value.href === 'string') return value.href;
    if (typeof value.alt === 'string' && value.alt) return value.alt;
    if (typeof value.filename === 'string') return value.filename;
  }
  return '';
}

/** A bound value as text, through the binding's format. */
export function formatValue(
  value: unknown,
  def: FieldDef | null,
  format: BindingFormat | undefined,
  ctx: RenderContext,
): string {
  const fallbackLocale = ctx.input.space?.defaultLocale ?? ctx.locale;
  switch (format?.type) {
    case 'date':
      return formatDate(value, format, ctx.locale, false);
    case 'number':
      return formatNumber(value, format, ctx.locale);
    case 'boolean': {
      if (value === null || value === undefined) return '';
      const on = value === true || value === 'true';
      const text = on ? format.trueText : format.falseText;
      return text ? localize(text, ctx.locale, fallbackLocale) : on ? 'Yes' : 'No';
    }
    case 'list': {
      const list = Array.isArray(value)
        ? value
        : value === null || value === undefined
          ? []
          : [value];
      return list
        .map((entry) => textOfOne(entry, def, ctx))
        .filter(Boolean)
        .join(format.separator ?? ', ');
    }
    case 'excerpt': {
      const text = textOfOne(value, def, ctx).replace(/\s+/g, ' ').trim();
      const length = format.length ?? 160;
      if (text.length <= length) return text;
      const cut = text.slice(0, length);
      const space = cut.lastIndexOf(' ');
      return `${(space > length * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
    }
    default:
      return textOfOne(value, def, ctx);
  }
}
