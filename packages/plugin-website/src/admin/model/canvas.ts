import {
  compileSiteCss,
  type FontFamily,
  type FontFile,
  type SiteCssDesign,
  type ThemeDesign,
} from '@manablox/site';
import { domainUrl } from './site-domains';

/** Where the site process serves the design canvas. */
export const CANVAS_PATH = '/_manablox/canvas';

/** The origin of a URL, or `null` when it is not one. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The public URL of a host name; local hosts use plain http on the site process's port. */
export const hostUrl = (hostname: string, siteUrl?: string | null): string =>
  domainUrl(hostname, siteUrl);

/** How the canvas reaches assets: drafts may use files the site does not serve yet. */
export interface CanvasAssets {
  /** A loaded font file as a `data:` URL; `null` skips it until it is loaded. */
  fontData: (assetId: string) => string | null;
  /** Origin of the admin's media route, for images. */
  mediaOrigin: string;
}

/** An asset's original, on the admin's media route. */
export const mediaPath = (assetId: string): string =>
  `/media/${encodeURIComponent(assetId)}/original`;

/**
 * The draft stylesheet for the canvas. Bundled fonts come from the site process; uploaded
 * ones are inlined, since the site only serves assets its live designs use.
 */
export function compileDraftCss(
  theme: ThemeDesign,
  designs: SiteCssDesign[],
  assets: CanvasAssets,
): string {
  const fontUrl = (file: FontFile, family: FontFamily): string | null => {
    if (family.source === 'bundled') {
      return file.bundledPath ? `/_site/fonts/${file.bundledPath}` : null;
    }
    return file.assetId ? assets.fontData(file.assetId) : null;
  };
  const assetUrl = (assetId: string) => `${assets.mediaOrigin}${mediaPath(assetId)}`;
  return compileSiteCss({ theme, designs, fontUrl, assetUrl });
}

/** Asset ids of a theme's uploaded and downloaded font files. */
export function fontAssetIds(theme: ThemeDesign): string[] {
  const ids = theme.fonts.families.flatMap((family) =>
    family.source === 'bundled' ? [] : family.files.map((file) => file.assetId ?? ''),
  );
  return [...new Set(ids.filter(Boolean))];
}

/** Where a share token opens the draft preview. */
export function shareUrl(origin: string, token: string): string {
  return `${origin}/_manablox/share/${encodeURIComponent(token)}`;
}

/**
 * The origins the admin uses: `canvas` frames the design canvas (the configured site URL,
 * else the primary domain), `live` is the public site (the primary domain).
 */
export function siteOrigins(
  siteUrl: string | null | undefined,
  domains: ReadonlyArray<{ hostname: string; isPrimary: boolean; locale: string | null }> = [],
): { canvas: string | null; live: string | null } {
  const primary =
    domains.find((domain) => domain.isPrimary && domain.locale === null) ??
    domains.find((domain) => domain.isPrimary) ??
    domains[0];
  const live = primary ? hostUrl(primary.hostname, siteUrl) : null;
  return { canvas: originOf(siteUrl) ?? live, live };
}
