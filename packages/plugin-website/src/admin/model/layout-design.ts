import {
  type DesignNode,
  findNode,
  type PageDesign,
  type SiteSettingsDesign,
  walkNodes,
} from '@manablox/site';
import { layoutKeyFor } from './site-preview';

/** Layout keys as the server accepts them. */
export const LAYOUT_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

/** A layout key from a name: lower case, dashes, unique among `taken`. */
export function layoutKeyFromName(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 56);
  const base = slug || 'layout';
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** How many `slot` elements a tree holds. */
export function slotCount(root: DesignNode): number {
  let count = 0;
  walkNodes(root, ({ node }) => {
    if (node.el === 'slot') count++;
    return undefined;
  });
  return count;
}

const holdsSlot = (root: DesignNode, id: string): boolean => {
  const found = findNode(root, id);
  return found ? slotCount(found.node) > 0 : false;
};

/** Why a node of a layout may not be removed: it is, or holds, the page content. */
export function slotRemovalError(root: DesignNode, id: string): string | null {
  return holdsSlot(root, id)
    ? 'This holds the page content. A layout needs exactly one, so move it elsewhere first.'
    : null;
}

/** Why a node of a layout may not be duplicated: the copy would hold a second slot. */
export function slotDuplicateError(root: DesignNode, id: string): string | null {
  return holdsSlot(root, id) ? 'A layout holds the page content only once.' : null;
}

/** Why a new `slot` may not be added. */
export function slotInsertError(root: DesignNode | null): string | null {
  return root && slotCount(root) > 0
    ? 'The layout already has its page content; a layout has exactly one.'
    : null;
}

export interface LayoutUse {
  typeId: string;
  /** `page`: the page design picks it; `site`: the site settings assign it; `default`: nothing else is set. */
  via: 'page' | 'site' | 'default';
}

/** Content types whose pages render in layout `key`. */
export function layoutUsage(
  key: string,
  typeIds: readonly string[],
  pages: Readonly<Record<string, PageDesign | null | undefined>>,
  site: Pick<SiteSettingsDesign, 'layouts'> | null,
  existing: ReadonlySet<string>,
): LayoutUse[] {
  const out: LayoutUse[] = [];
  for (const typeId of typeIds) {
    const page = pages[typeId];
    const wanted = layoutKeyFor(page, site, typeId);
    // A missing layout falls back to `default`.
    const used = wanted === 'default' || existing.has(wanted) ? wanted : 'default';
    if (used !== key) continue;
    const via =
      used !== wanted
        ? 'default'
        : page?.layout
          ? 'page'
          : site?.layouts?.[typeId]
            ? 'site'
            : 'default';
    out.push({ typeId, via });
  }
  return out;
}

/** Site settings with every assignment of layout `from` moved to `to` (or dropped for `default`). */
export function reassignSiteLayouts(
  site: SiteSettingsDesign,
  from: string,
  to: string,
): SiteSettingsDesign {
  const layouts: Record<string, string> = {};
  for (const [typeId, key] of Object.entries(site.layouts ?? {})) {
    const next = key === from ? to : key;
    if (next !== 'default') layouts[typeId] = next;
  }
  return { ...site, layouts };
}

/** A page design that picks layout `to` instead of `from`; `default` clears the pick. */
export function reassignPageLayout(page: PageDesign, from: string, to: string): PageDesign {
  if (page.layout !== from) return page;
  const next: PageDesign = { ...page };
  if (to === 'default') delete next.layout;
  else next.layout = to;
  return next;
}
