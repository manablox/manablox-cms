import type { ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  defaultSiteSettings,
  type SiteAsset,
  type SiteRenderInput,
  type ThemeDesign,
} from '@manablox/site';

export interface BlockCanvasSource {
  typeId: string;
  design: BlockDesign;
  theme: ThemeDesign;
  space: { id: string; name: string; defaultLocale: string; locales: string[] };
  locale: string;
  /** Every type of the space, so nested blocks render with their own designs. */
  contentTypes: Record<string, ContentTypeDefinition>;
  /** Stored designs of other block types, by type id; the rest are generated. */
  blockDesigns?: Record<string, BlockDesign>;
  /** The block's values, by field name. */
  fields: Record<string, unknown>;
  assets: Record<string, SiteAsset>;
}

/**
 * The canvas input for one block: its values stand in as the document's fields, so the
 * canvas, focused on the block design, renders just this block without a layout.
 */
export function blockCanvasInput(source: BlockCanvasSource): SiteRenderInput {
  const { typeId, space, locale } = source;
  return {
    mode: 'canvas',
    space,
    locale,
    url: '/',
    alternates: [],
    document: {
      id: 'sample',
      localizationId: 'sample',
      typeId,
      title: 'Sample',
      permalink: '/',
      publishedAt: null,
      fields: source.fields,
    },
    status: 200,
    contentTypes: source.contentTypes,
    page: { key: typeId, design: { root: { id: 'root', el: 'box' } } },
    layout: { key: 'default', design: { root: { id: 'root', el: 'slot' } } },
    blockDesigns: { ...source.blockDesigns, [typeId]: source.design },
    menuDesigns: {},
    menus: {},
    theme: source.theme,
    site: { ...defaultSiteSettings(), name: space.name },
    assets: source.assets,
    cssHref: '',
    formActionBase: '',
  };
}
