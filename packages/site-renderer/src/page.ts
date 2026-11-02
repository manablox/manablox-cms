import type { SiteRenderInput } from '@manablox/site';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { resolveField } from './bindings.js';
import { documentScope, renderBody } from './body.js';
import { createContext, type Frame, type RenderContext } from './context.js';
import {
  ISLAND_NAMES,
  type IslandName,
  type RenderOptions,
  type SiteBadge,
  type SiteHead,
  type SiteRenderResult,
} from './types.js';
import { escapeHtml, localize, safeHref } from './util.js';
import { asAsset, formatValue } from './values.js';

const attr = (value: string) => escapeHtml(value);

/** `{title}` and `{site}` of the title pattern; the site name alone without a title. */
export function pageTitle(input: SiteRenderInput): string {
  const site = input.site?.name || input.space?.name || '';
  const title = input.document
    ? input.document.title
    : input.status === 404
      ? 'Page not found'
      : '';
  if (!title) return site;
  const pattern = input.site?.titlePattern || '{title} | {site}';
  if (!site) return title;
  return pattern
    .replace(/\{title\}/g, title)
    .replace(/\{site\}/g, site)
    .trim();
}

function assetUrl(input: SiteRenderInput, id: string | null | undefined): string | null {
  if (!id) return null;
  return safeHref(input.assets?.[id]?.url);
}

/** Description and share image the page design takes from the document's fields. */
function pageSeo(ctx: RenderContext): { description: string; image: string | null } {
  const seo = ctx.input.page?.design?.seo;
  if (!ctx.input.document || !seo) return { description: '', image: null };
  const frame: Frame = {
    kind: 'page',
    key: ctx.input.page.key,
    data: documentScope(ctx),
    markers: false,
  };
  let description = '';
  if (seo.description) {
    const { value, def } = resolveField(seo.description, frame, ctx);
    description = formatValue(value, def, { type: 'excerpt', length: 160 }, ctx);
  }
  const image = seo.image ? asAsset(resolveField(seo.image, frame, ctx).value, ctx) : null;
  return { description, image: image ? safeHref(image.url) : null };
}

/** Absolute form of a root-relative URL, against the page URL. */
function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function fontPreloads(ctx: RenderContext): string[] {
  const { theme } = ctx.input;
  const families = theme?.fonts?.families ?? [];
  const wanted = new Set([theme?.fonts?.roles?.body, theme?.fonts?.roles?.heading]);
  const out: string[] = [];
  for (const family of families) {
    if (!wanted.has(family.id)) continue;
    const file = family.files?.find((entry) => entry.style !== 'italic') ?? family.files?.[0];
    if (!file) continue;
    const url = ctx.options.fontUrl
      ? ctx.options.fontUrl(file, family)
      : family.source === 'bundled' && file.bundledPath
        ? `/_site/fonts/${file.bundledPath}`
        : null;
    if (url && safeHref(url) && !out.includes(url)) out.push(url);
  }
  return out.map(
    (url) => `<link rel="preload" href="${attr(url)}" as="font" type="font/woff2" crossorigin>`,
  );
}

function headHtml(ctx: RenderContext, head: SiteHead): string {
  const { input } = ctx;
  const live = input.mode === 'live';
  const lines: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(head.title)}</title>`,
  ];
  if (head.description) lines.push(`<meta name="description" content="${attr(head.description)}">`);
  if (!live || input.site?.robots?.index === false)
    lines.push('<meta name="robots" content="noindex, nofollow">');
  if (live && safeHref(input.url)) {
    lines.push(`<link rel="canonical" href="${attr(input.url)}">`);
    const alternates = (input.alternates ?? []).filter((entry) => safeHref(entry.url));
    if (alternates.length > 1) {
      for (const entry of alternates)
        lines.push(
          `<link rel="alternate" hreflang="${attr(entry.locale)}" href="${attr(entry.url)}">`,
        );
      const fallback = alternates.find((entry) => entry.locale === input.space?.defaultLocale);
      if (fallback)
        lines.push(`<link rel="alternate" hreflang="x-default" href="${attr(fallback.url)}">`);
    }
  }

  const site = input.site?.name || input.space?.name || '';
  const image = head.image ?? null;
  const og: Array<[string, string]> = [
    ['og:type', 'website'],
    ['og:title', input.document?.title || head.title],
    ['og:url', input.url],
    ['og:locale', ctx.locale.replace('-', '_')],
  ];
  if (site) og.push(['og:site_name', site]);
  if (head.description) og.push(['og:description', head.description]);
  if (image) og.push(['og:image', absolute(image, input.url)]);
  for (const [property, content] of og)
    if (content) lines.push(`<meta property="${property}" content="${attr(content)}">`);
  lines.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);

  const favicon = input.site?.favicon ? input.assets?.[input.site.favicon] : null;
  const faviconUrl = safeHref(favicon?.url);
  if (faviconUrl) {
    const type = favicon?.mimeType ? ` type="${attr(favicon.mimeType)}"` : '';
    lines.push(`<link rel="icon" href="${attr(faviconUrl)}"${type}>`);
  }
  lines.push(...fontPreloads(ctx));
  if (input.cssHref) lines.push(`<link rel="stylesheet" href="${attr(input.cssHref)}">`);
  if (input.mode !== 'canvas' && input.site?.headCode) lines.push(input.site.headCode);
  return lines.join('\n');
}

/** Small fixed badge on share-link pages. */
export const PREVIEW_BADGE =
  '<div class="mb-preview-badge" role="status" style="position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:4px 10px;border-radius:999px;background:#111;color:#fff;font:600 12px/1.6 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none">Preview</div>';

/** The "Made with" link; inline styles that reset the site's own, so no site CSS reaches it. */
function siteBadgeHtml(badge: SiteBadge): string {
  const href = safeHref(badge.link);
  if (!href || !badge.text) return '';
  return `<a class="mb-site-badge" href="${attr(href)}" target="_blank" rel="noopener" style="all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483646;display:inline-block;box-sizing:border-box;padding:4px 10px;border-radius:999px;background:#fff;color:#111;border:1px solid rgba(0,0,0,.15);box-shadow:0 1px 3px rgba(0,0,0,.12);font:500 12px/1.6 system-ui,sans-serif;text-decoration:none;cursor:pointer">${escapeHtml(badge.text)}</a>`;
}

function islandScripts(ctx: RenderContext, islands: IslandName[]): string {
  return islands
    .map((name) => {
      const src = ctx.options.islandSrc?.[name] ?? `/_site/islands/${name}.js`;
      return `<script type="module" src="${attr(src)}"></script>`;
    })
    .join('');
}

/** Renders a full HTML document for one page. */
export async function renderSitePage(
  input: SiteRenderInput,
  options: RenderOptions = {},
): Promise<SiteRenderResult> {
  const ctx = createContext(input, options);
  const app = createSSRApp({ render: () => renderBody(ctx) });
  const body = await renderToString(app);

  const fallbackLocale = input.space?.defaultLocale ?? ctx.locale;
  const seo = pageSeo(ctx);
  const head: SiteHead = {
    title: pageTitle(input),
    description:
      seo.description || localize(input.site?.meta?.description, ctx.locale, fallbackLocale),
    image: seo.image ?? assetUrl(input, input.site?.meta?.ogImage),
  };
  const islands =
    input.mode === 'canvas' ? [] : ISLAND_NAMES.filter((name) => ctx.islands.has(name));
  const tail = [
    input.mode === 'share' ? PREVIEW_BADGE : '',
    input.mode !== 'canvas' && options.badge ? siteBadgeHtml(options.badge) : '',
    input.mode !== 'canvas' ? (input.site?.bodyEndCode ?? '') : '',
    islandScripts(ctx, islands),
  ].join('');

  const html = `<!doctype html>\n<html lang="${attr(ctx.locale)}">\n<head>\n${headHtml(ctx, head)}\n</head>\n<body>\n${body}\n${tail}</body>\n</html>\n`;
  return {
    html,
    status: input.status || 200,
    head,
    islands,
    instanceStyles: [...ctx.instanceStyles.values()],
  };
}
