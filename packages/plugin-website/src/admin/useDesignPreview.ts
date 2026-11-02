import { useAssetsByIds, useCan, useSpaceStore } from '@manablox/admin-sdk';
import type { ContentTypeDefinition } from '@manablox/core';
import type {
  CanvasFocus,
  LayoutDesign,
  MenuDesign,
  PageDesign,
  SiteAsset,
  SiteDocument,
  SiteMenu,
  ThemeDesign,
} from '@manablox/site';
import { computed } from 'vue';
import { mediaPath } from './model/canvas';
import { canvasAssetIds } from './model/canvas-fields';
import { sampleAssets } from './model/sample-data';
import { contentCanvasCss } from './model/site-canvas';
import { toSiteMenu } from './model/site-links';
import { designPreview } from './model/site-preview';
import { useCanvasDesigns, useCanvasMenus } from './queries';
import { useCanvasAssets } from './useCanvasAssets';
import type { CanvasPayload } from './useDesignCanvas';
import { useSiteContext } from './useSiteContext';

type Ref<T> = { key: string; design: T };

export interface DesignPreviewOptions {
  locale: () => string;
  theme: () => ThemeDesign | null;
  page: () => Ref<PageDesign> | null;
  layout?: () => Ref<LayoutDesign> | null;
  menuDesign?: () => Ref<MenuDesign> | null;
  /** A menu to resolve although no element places it. */
  extraMenu?: () => string | undefined;
  document: () => SiteDocument | null;
  /** The document's type, for its asset fields. */
  documentType: () => ContentTypeDefinition | null;
  /** The document holds generated values, so the placeholder picture is needed. */
  sample: () => boolean;
  focus: () => CanvasFocus | null;
}

/**
 * The canvas of the page, layout and menu designers: every stored design's draft, the edited
 * one in its place, the space's menus and the assets they show.
 */
export function useDesignPreview(options: DesignPreviewOptions) {
  const spaces = useSpaceStore();
  const canReadMenus = useCan('menu:read');
  const rows = useCanvasDesigns(true);
  const menus = useCanvasMenus(options.locale, canReadMenus);

  const site = useSiteContext();
  const siteMenus = computed(() => {
    const out: Record<string, SiteMenu> = {};
    const links = {
      locale: options.locale(),
      link: site.link.value,
      homeContentId: spaces.homeContentId,
    };
    for (const detail of menus.data.value ?? [])
      out[detail.menu.machineName] = toSiteMenu(detail.menu, detail.items, null, links);
    return out;
  });

  const types = computed(() => spaces.contentTypes);

  const base = computed(() => {
    const space = spaces.current;
    const theme = options.theme();
    const page = options.page();
    if (!space || !theme || !page || rows.isPending.value) return null;
    return designPreview({
      space: {
        id: space.id,
        name: space.name,
        defaultLocale: space.defaultLocale,
        locales: space.locales,
      },
      locale: options.locale(),
      types: types.value,
      rows: rows.data.value ?? [],
      menus: siteMenus.value,
      assets: {},
      theme,
      page,
      layout: options.layout?.() ?? undefined,
      menuDesign: options.menuDesign?.() ?? undefined,
      extraMenu: options.extraMenu?.(),
      document: options.document(),
    });
  });

  const assetKey = computed(() => {
    const canvas = base.value;
    if (!canvas) return '';
    const { input } = canvas;
    return canvasAssetIds(
      options.document()?.fields ?? {},
      options.documentType(),
      (id) => spaces.typeById(id) ?? null,
      [input.theme, input.site, ...canvas.designs.map((design) => design.data)],
    ).join(',');
  });
  const assetRows = useAssetsByIds(() => (assetKey.value ? assetKey.value.split(',') : []));
  const assets = computed(() => {
    const origin = window.location.origin;
    const out: Record<string, SiteAsset> = options.sample() ? sampleAssets() : {};
    for (const row of assetRows.data.value ?? []) {
      if (!row) continue;
      out[row.id] = {
        url: `${origin}${mediaPath(row.id)}`,
        width: row.width,
        height: row.height,
        alt: row.alt,
        mimeType: row.mimeType,
      };
    }
    return out;
  });

  const fontAssets = useCanvasAssets(options.theme);
  const css = computed(() =>
    base.value ? contentCanvasCss(base.value, [], fontAssets.value) : '',
  );

  const payload = computed<CanvasPayload | null>(() => {
    const canvas = base.value;
    if (!canvas) return null;
    return {
      input: { ...canvas.input, assets: assets.value },
      css: css.value,
      focus: options.focus(),
    };
  });

  return { payload, menus: siteMenus, menusQuery: menus };
}
