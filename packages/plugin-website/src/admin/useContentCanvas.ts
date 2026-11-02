import {
  type ContentTypeSummary,
  type DraftDocument,
  plainClone,
  useAssetsByIds,
  useCan,
  useContentByIds,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlockInstanceStyle, SiteAsset, SiteMenu } from '@manablox/site';
import { computed, ref } from 'vue';
import { CANVAS_PATH, mediaPath } from './model/canvas';
import {
  type CanvasLinkTarget,
  canvasAssetIds,
  canvasLinkIds,
  instanceStylesOf,
  withCanvasLinks,
} from './model/canvas-fields';
import { jsonEqual } from './model/plain-data';
import {
  type CanvasDesignVariant,
  contentCanvasCss,
  contentCanvasInput,
} from './model/site-canvas';
import { toSiteMenu } from './model/site-links';
import { useCanvasDesigns, useCanvasMenus } from './queries';
import { useCanvasAssets } from './useCanvasAssets';
import { useSiteContext } from './useSiteContext';

export interface ContentCanvasOptions {
  doc: () => DraftDocument | null;
  contentType: () => ContentTypeSummary | null;
}

/**
 * The site canvas of a designed space in content mode: where it lives and what it renders
 * (published designs by default, drafts on request, with the document's draft).
 */
export function useContentCanvas(options: ContentCanvasOptions) {
  const spaces = useSpaceStore();
  const site = useSiteContext();
  const canReadMenus = useCan('menu:read');
  const variant = ref<CanvasDesignVariant>('published');
  const locale = computed(() => options.doc()?.locale ?? spaces.locale);

  const designed = computed(() => site.designed.value);
  const designs = useCanvasDesigns(() => designed.value && site.canRead.value);
  const menus = useCanvasMenus(locale, () => designed.value && canReadMenus.value);

  const siteMenus = computed(() => {
    const out: Record<string, SiteMenu> = {};
    const links = {
      locale: locale.value,
      link: site.link.value,
      homeContentId: spaces.homeContentId,
    };
    for (const detail of menus.data.value ?? [])
      out[detail.menu.machineName] = toSiteMenu(detail.menu, detail.items, null, links);
    return out;
  });

  // Related documents, inlined into the rendered draft like delivery does.
  const typeOf = (id: string) => spaces.typeById(id) ?? null;
  const linkKey = computed(() => {
    const doc = options.doc();
    if (!doc || !designed.value) return '';
    const type = options.contentType();
    return canvasLinkIds(doc.fields, type, typeOf).join(',');
  });
  const related = useContentByIds(() => (linkKey.value ? linkKey.value.split(',') : []));
  const targets = computed(() => {
    const out = new Map<string, CanvasLinkTarget>();
    for (const row of related.data.value ?? []) {
      if (!row) continue;
      const permalink = row.id === spaces.homeContentId ? '' : (row.permalink ?? null);
      out.set(row.id, {
        id: row.id,
        title: row.title,
        permalink,
        locale: row.locale,
        fields: row.fields,
      });
    }
    return out;
  });
  /** The draft's fields as the canvas renders them. */
  const fields = (values: Record<string, unknown>): Record<string, unknown> =>
    withCanvasLinks(values, options.contentType(), typeOf, targets.value, site.link.value);

  const ready = computed(
    () =>
      designed.value &&
      (!site.canRead.value || designs.isSuccess.value || designs.isError.value) &&
      (!canReadMenus.value || menus.isSuccess.value || menus.isError.value),
  );

  const base = computed(() => {
    const space = spaces.current;
    const type = options.contentType();
    if (!ready.value || !space || !type) return null;
    return contentCanvasInput({
      space: {
        id: space.id,
        name: space.name,
        defaultLocale: space.defaultLocale,
        locales: space.locales,
      },
      locale: locale.value,
      types: spaces.contentTypes,
      pageTypeId: type.id,
      rows: designs.data.value ?? [],
      variant: variant.value,
      menus: siteMenus.value,
      assets: {},
    });
  });

  // Keys keep the edits that do not change them from recompiling the stylesheet.
  const assetKey = computed(() => {
    const doc = options.doc();
    const canvas = base.value;
    if (!doc || !canvas) return '';
    const { input } = canvas;
    const typeById = (id: string) => spaces.typeById(id) ?? null;
    const ids = canvasAssetIds(doc.fields, options.contentType(), typeById, [
      input.theme,
      input.site,
      ...canvas.designs.map((design) => design.data),
    ]);
    // Images of related documents, which designs may show.
    for (const row of related.data.value ?? [])
      if (row) ids.push(...canvasAssetIds(row.fields, typeById(row.typeId), typeById));
    return [...new Set(ids)].sort().join(',');
  });
  const assetRows = useAssetsByIds(() => (assetKey.value ? assetKey.value.split(',') : []));
  const assets = computed(() => {
    const out: Record<string, SiteAsset> = {};
    for (const row of assetRows.data.value ?? []) {
      if (!row) continue;
      out[row.id] = {
        url: `${window.location.origin}${mediaPath(row.id)}`,
        width: row.width,
        height: row.height,
        alt: row.alt,
        mimeType: row.mimeType,
      };
    }
    return out;
  });

  // Kept while equal, so edits that leave the overrides alone do not recompile the
  // stylesheet; copied, since the document's fields change in place.
  const instanceStyles = computed<BlockInstanceStyle[]>((previous) => {
    const next = instanceStylesOf(options.doc()?.fields ?? {}).map((style) => plainClone(style));
    return previous && jsonEqual(previous, next) ? previous : next;
  });
  const fontAssets = useCanvasAssets(() => base.value?.input.theme ?? null);
  const css = computed(() => {
    const canvas = base.value;
    if (!canvas) return '';
    return contentCanvasCss(canvas, instanceStyles.value, fontAssets.value);
  });

  /** What the canvas renders; the bridge adds the draft document. */
  const payload = computed(() => {
    const canvas = base.value;
    if (!canvas) return null;
    // Related documents arriving re-send the draft.
    void targets.value;
    return { input: { ...canvas.input, assets: assets.value }, css: css.value };
  });

  return {
    /** The site mode is known; until then nothing is framed. */
    resolved: computed(() => !site.settings.isPending.value),
    designed,
    /** The site process's canvas page. */
    src: computed(() =>
      site.canvasOrigin.value ? `${site.canvasOrigin.value}${CANVAS_PATH}` : null,
    ),
    origin: site.canvasOrigin,
    /** Where share links open. */
    shareOrigin: computed(() => site.liveOrigin.value ?? site.canvasOrigin.value),
    /** Without `website:read` the canvas shows generated designs. */
    generatedOnly: computed(() => designed.value && !site.canRead.value),
    variant,
    payload,
    fields,
  };
}
