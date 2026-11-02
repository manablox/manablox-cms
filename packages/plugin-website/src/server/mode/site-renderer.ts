import { readFile } from 'node:fs/promises';
import type { InstanceStyle, SiteRenderInput } from '@manablox/site';
import {
  type FormResult,
  renderCanvasPage,
  renderSitePage,
  type SiteBadge,
} from '@manablox/site-renderer';
import {
  bundledFontFile,
  clientAssetUrls,
  findClientAsset,
  loadClientAssets,
} from '@manablox/site-renderer/assets';
import { siteFontUrl } from '../services/site/designs.js';

/** A static file the renderer ships: island scripts, the canvas bundle. */
export interface SiteRendererFile {
  body: string | Uint8Array;
  contentType: string;
}

export interface SiteRenderedPage {
  html: string;
  status: number;
  /** Block instance overrides on the page, which the stylesheet needs classes for. */
  instanceStyles?: InstanceStyle[] | undefined;
}

export interface SitePageOptions {
  formResult?: FormResult | undefined;
  /** Signs the databag type of a form bound to a field. */
  formToken?: ((ref: string, databagTypeId: string) => string) | undefined;
  /** Shown when the space's `siteBadge` is on. */
  badge?: SiteBadge | undefined;
}

/** What the site surface needs from `@manablox/site-renderer`; tests pass their own. */
export interface SiteRenderer {
  /** `formResult`: the outcome of a form posted without JavaScript, shown on the page. */
  renderPage(input: SiteRenderInput, options?: SitePageOptions): Promise<SiteRenderedPage>;
  /** A browser bundle below `/_site/`: `islands/<name>.<hash>.js`, `canvas.<hash>.js`. */
  clientFile(path: string): Promise<SiteRendererFile | null>;
  /** A bundled font by its path below the font folder. */
  font(path: string): Promise<Uint8Array | null>;
  /** The canvas page, driven by the editor at `editorOrigin`. */
  canvasPage(editorOrigin: string): Promise<string>;
}

/**
 * `@manablox/site-renderer` with its bundles served below `/_site/`; `imageWidths` are the
 * media presets' widths, for `srcset`.
 */
export function siteRenderer(imageWidths?: Record<string, number>): SiteRenderer {
  const fonts = new Map<string, Promise<Uint8Array | null>>();
  return {
    async renderPage(input, options) {
      const { islandSrc } = clientAssetUrls(await loadClientAssets());
      return renderSitePage(input, {
        islandSrc,
        fontUrl: siteFontUrl,
        ...(imageWidths ? { imageWidths } : {}),
        ...(options?.formResult ? { formResult: options.formResult } : {}),
        ...(options?.formToken ? { formToken: options.formToken } : {}),
        ...(options?.badge ? { badge: options.badge } : {}),
      });
    },
    async clientFile(path) {
      const asset = findClientAsset(await loadClientAssets(), path);
      return asset ? { body: asset.code, contentType: 'text/javascript; charset=utf-8' } : null;
    },
    font(path) {
      const file = bundledFontFile(path);
      if (!file) return Promise.resolve(null);
      let pending = fonts.get(path);
      if (!pending) {
        pending = readFile(file).then(
          (body) => new Uint8Array(body),
          () => null,
        );
        fonts.set(path, pending);
      }
      return pending;
    },
    async canvasPage(editorOrigin) {
      const { canvasSrc } = clientAssetUrls(await loadClientAssets());
      return renderCanvasPage({ scriptSrc: canvasSrc, editorOrigin });
    },
  };
}
