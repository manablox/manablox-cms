import { richTextToHtml } from '@manablox/public-sdk';
import {
  BUTTON_CLASS,
  BUTTON_VARIANTS,
  buttonClass,
  type ContentElement,
  PROSE_CLASS,
} from '@manablox/site';
import { h, type VNodeChild } from 'vue';
import { resolveBinding } from '../bindings.js';
import type { RenderContext } from '../context.js';
import { embedFor } from '../embed.js';
import { ICONS } from '../icons.js';
import { fieldMarker } from '../markers.js';
import type { ElementArgs, ElementRenderer } from '../renderer.js';
import { escapeHtml, isRecord, safeHref } from '../util.js';
import { asAsset, asLink, formatValue, type RenderAsset, type RenderLink } from '../values.js';
import { empty, relFor, text } from './shared.js';
import { tagOf } from './structure.js';

const TEXT_TAGS = [
  'p',
  'span',
  'div',
  'pre',
  'small',
  'strong',
  'em',
  'blockquote',
  'figcaption',
  'address',
  'code',
];

/** Bound text, else the static `props[prop]`, with its field marker. */
function contentText(
  { node, frame, ctx }: Pick<ElementArgs, 'node' | 'frame' | 'ctx'>,
  prop = 'text',
): { value: string; marker: Record<string, string> } {
  const resolved = resolveBinding(node.bind, frame, ctx);
  const bound = resolved ? formatValue(resolved.value, resolved.def, node.bind?.format, ctx) : '';
  return {
    value: bound || text(ctx, node.props?.[prop]),
    marker: resolved ? fieldMarker(ctx, resolved.path) : {},
  };
}

const textElement: ElementRenderer = (args) => {
  const { node, ctx, attrs } = args;
  const tag = tagOf(node.props?.as, TEXT_TAGS, 'p');
  const { value, marker } = contentText(args);
  if (!value) return empty(ctx, { ...attrs, ...marker }, tag, 'Text');
  return h(tag, { ...attrs, ...marker }, value);
};

const heading: ElementRenderer = (args) => {
  const { node, ctx, attrs } = args;
  const raw = Number(node.props?.level);
  const level = Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 2;
  const { value, marker } = contentText(args);
  if (!value) return empty(ctx, { ...attrs, ...marker }, `h${level}`, 'Heading');
  return h(`h${level}`, { ...attrs, ...marker }, value);
};

/** Plain text as paragraphs, escaped. */
function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const richtext: ElementRenderer = ({ node, frame, ctx, attrs }) => {
  const resolved = resolveBinding(node.bind, frame, ctx);
  const value = resolved?.value;
  // `richTextToHtml` escapes text and keeps a fixed tag set, so its output is safe.
  const html =
    typeof value === 'string' ? paragraphs(value) : isRecord(value) ? richTextToHtml(value) : '';
  const marker = resolved ? fieldMarker(ctx, resolved.path) : {};
  const classes = [...attrs.class, PROSE_CLASS];
  if (!html) return empty(ctx, { ...attrs, class: classes, ...marker }, 'div', 'Rich text');
  return h('div', { ...attrs, class: classes, ...marker, innerHTML: html });
};

/** `srcset` from the asset's variants whose preset width is known, plus the original. */
function srcset(asset: RenderAsset, ctx: RenderContext): string | undefined {
  const widths = ctx.options.imageWidths ?? { thumb: 320, card: 640, hero: 1920 };
  const entries: Array<[string, number]> = [];
  for (const [preset, width] of Object.entries(widths)) {
    const url = safeHref(asset.variants?.[preset]);
    if (url && Number.isFinite(width) && width > 0) entries.push([url, width]);
  }
  if (entries.length === 0) return undefined;
  if (asset.width && !entries.some(([, width]) => width >= (asset.width as number)))
    entries.push([asset.url, asset.width]);
  return entries
    .sort((a, b) => a[1] - b[1])
    .map(([url, width]) => `${url} ${width}w`)
    .join(', ');
}

function assetOf(args: ElementArgs): { asset: RenderAsset | null; marker: Record<string, string> } {
  const { node, frame, ctx } = args;
  const resolved = resolveBinding(node.bind, frame, ctx);
  const asset = asAsset(resolved?.value, ctx) ?? asAsset(node.props?.assetId, ctx);
  return { asset, marker: resolved ? fieldMarker(ctx, resolved.path) : {} };
}

const image: ElementRenderer = (args) => {
  const { node, ctx, attrs } = args;
  const { asset, marker } = assetOf(args);
  if (!asset) return empty(ctx, { ...attrs, ...marker }, 'div', 'Image');
  const eager = node.props?.loading === 'eager';
  // Lazy loading never fires inside the admin's scaled canvas frame.
  const lazy = !eager && !ctx.canvas;
  const set = srcset(asset, ctx);
  const focal = asset.focalPoint;
  const position =
    focal && Number.isFinite(focal.x) && Number.isFinite(focal.y)
      ? `object-position:${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%`
      : '';
  return h('img', {
    ...attrs,
    ...marker,
    src: asset.url,
    srcset: set,
    sizes: set
      ? typeof node.props?.sizes === 'string' && /^[\w\s(),.:%-]{1,200}$/.test(node.props.sizes)
        ? node.props.sizes
        : '100vw'
      : undefined,
    alt: text(ctx, node.props?.alt) || asset.alt || '',
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    loading: lazy ? 'lazy' : 'eager',
    fetchpriority: eager ? 'high' : undefined,
    decoding: 'async',
    style: [attrs.style, position].filter(Boolean).join(';') || undefined,
  });
};

const video: ElementRenderer = (args) => {
  const { node, ctx, attrs } = args;
  const { asset, marker } = assetOf(args);
  if (!asset) return empty(ctx, { ...attrs, ...marker }, 'div', 'Video');
  const autoplay = node.props?.autoplay === true;
  return h('video', {
    ...attrs,
    ...marker,
    src: asset.url,
    controls: node.props?.controls !== false,
    autoplay,
    // Browsers only autoplay muted video.
    muted: autoplay || node.props?.muted === true,
    loop: node.props?.loop === true,
    playsinline: true,
    preload: 'metadata',
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  });
};

const icon: ElementRenderer = ({ node, ctx, attrs }) => {
  const name = typeof node.props?.name === 'string' ? node.props.name : '';
  const paths = Object.hasOwn(ICONS, name) ? ICONS[name] : null;
  if (!paths) return empty(ctx, attrs, 'span', 'Icon');
  const label = text(ctx, node.props?.label);
  return h('svg', {
    ...attrs,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
    focusable: 'false',
    innerHTML: paths,
  });
};

/** The link of a `link` or `button`: bound value first, then `props.href`. */
function linkOf(args: ElementArgs): { link: RenderLink | null; marker: Record<string, string> } {
  const { node, frame, ctx } = args;
  const resolved = resolveBinding(node.bind, frame, ctx);
  let link = resolved ? asLink(resolved.value, ctx) : null;
  if (!link) {
    const href = safeHref(node.props?.href);
    if (href) link = { href, target: '_self', label: '' };
  }
  if (link && (node.props?.target === '_blank' || node.props?.target === '_self'))
    link = { ...link, target: node.props.target };
  return { link, marker: resolved ? fieldMarker(ctx, resolved.path) : {} };
}

function anchorAttrs(link: RenderLink | null): Record<string, unknown> {
  if (!link) return {};
  return {
    href: link.href,
    target: link.target === '_blank' ? '_blank' : undefined,
    rel: relFor(link.target),
  };
}

const linkElement: ElementRenderer = (args) => {
  const { node, ctx, attrs, children } = args;
  const { link, marker } = linkOf(args);
  const content: VNodeChild[] = node.children?.length
    ? children()
    : [text(ctx, node.props?.text) || link?.label || (ctx.canvas ? '' : link?.href) || ''];
  const hasContent = content.some((entry) => entry !== null && entry !== '');
  if (!link && !ctx.canvas) return hasContent ? h('span', attrs, content) : null;
  if (!hasContent) return empty(ctx, { ...attrs, ...marker, ...anchorAttrs(link) }, 'a', 'Link');
  return h('a', { ...attrs, ...marker, ...anchorAttrs(link) }, content);
};

const button: ElementRenderer = (args) => {
  const { node, ctx, attrs } = args;
  const { link, marker } = linkOf(args);
  const variant = (BUTTON_VARIANTS as readonly unknown[]).includes(node.props?.variant)
    ? (node.props?.variant as string)
    : 'primary';
  const label = text(ctx, node.props?.text) || link?.label || '';
  const classes = [...attrs.class, BUTTON_CLASS, buttonClass(variant as 'primary')];
  if (!label) return empty(ctx, { ...attrs, ...marker, class: classes }, 'a', 'Button');
  return h('a', { ...attrs, ...marker, class: classes, ...anchorAttrs(link) }, label);
};

const embed: ElementRenderer = ({ node, frame, ctx, attrs }) => {
  const resolved = resolveBinding(node.bind, frame, ctx);
  const bound = resolved ? (asLink(resolved.value, ctx)?.href ?? resolved.value) : null;
  const found =
    embedFor(bound, node.props?.provider) ?? embedFor(node.props?.url, node.props?.provider);
  const marker = resolved ? fieldMarker(ctx, resolved.path) : {};
  if (!found) return empty(ctx, { ...attrs, ...marker }, 'div', 'Embed');
  return h('iframe', {
    ...attrs,
    ...marker,
    src: found.src,
    title: text(ctx, node.props?.title) || found.provider,
    loading: ctx.canvas ? 'eager' : 'lazy',
    allow: found.allow,
    allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin',
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation',
  });
};

export const contentElements: Record<ContentElement, ElementRenderer> = {
  text: textElement,
  heading,
  richtext,
  image,
  video,
  icon,
  link: linkElement,
  button,
  embed,
};
