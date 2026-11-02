import type { SiteDesignKindName } from '../../sdk';

export type DesignStatus = 'generated' | 'unpublished' | 'changed' | 'published';

/** Badge text, tone and a sentence per status. */
export const STATUS_META: Record<DesignStatus, { label: string; tone: string; hint: string }> = {
  generated: {
    label: 'automatic',
    tone: 'mb-badge',
    hint: 'Nobody has changed it yet; the site builds it automatically from your content types.',
  },
  unpublished: {
    label: 'draft',
    tone: 'mb-badge-warn',
    hint: 'Saved but never published; visitors still see the automatic design.',
  },
  changed: {
    label: 'not published',
    tone: 'mb-badge-warn',
    hint: 'You changed it since the last publish; visitors see the older version until you publish.',
  },
  published: { label: 'live', tone: 'mb-badge-ok', hint: 'Visitors see this design.' },
};

/** Section headings of the overview, in order. */
export const KIND_SECTIONS: ReadonlyArray<{
  kind: SiteDesignKindName;
  label: string;
  icon: string;
}> = [
  { kind: 'theme', label: 'Theme', icon: 'palette' },
  { kind: 'site', label: 'Site settings', icon: 'globe' },
  { kind: 'layout', label: 'Layouts', icon: 'panels-top-left' },
  { kind: 'page', label: 'Pages', icon: 'doc' },
  { kind: 'block', label: 'Blocks', icon: 'blocks' },
  { kind: 'menu', label: 'Menus', icon: 'menu' },
];

/**
 * The editor route of a design, or `null` while its designer does not exist yet. Without a
 * key, the list of that kind's designs.
 */
export function designRoute(kind: SiteDesignKindName, key?: string): string | null {
  if (kind === 'site') return '/design/site';
  if (kind === 'theme') return '/design/theme';
  const list = LIST_ROUTES[kind];
  return key ? `${list}/${encodeURIComponent(key)}` : list;
}

const LIST_ROUTES: Record<'block' | 'page' | 'layout' | 'menu', string> = {
  block: '/design/blocks',
  page: '/design/pages',
  layout: '/design/layouts',
  menu: '/design/menus',
};

/** The Design section's pages, for its side navigation. */
export const DESIGN_NAV: ReadonlyArray<{
  to: string;
  label: string;
  icon: string;
  hint: string;
}> = [
  { to: '/design', label: 'Overview', icon: 'home', hint: 'Start here and publish' },
  { to: '/design/theme', label: 'Theme', icon: 'palette', hint: 'Colors, fonts, spacing' },
  { to: '/design/pages', label: 'Pages', icon: 'doc', hint: 'How each kind of page looks' },
  { to: '/design/blocks', label: 'Blocks', icon: 'blocks', hint: 'Sections editors add to pages' },
  { to: '/design/layouts', label: 'Layouts', icon: 'panels-top-left', hint: 'Header and footer' },
  { to: '/design/menus', label: 'Menus', icon: 'menu', hint: 'Navigation bars and lists' },
  { to: '/design/site', label: 'Site settings', icon: 'settings', hint: 'Name, logo, search' },
];

/** The overview's cards: what each part of the design controls, in plain words. */
export const DESIGN_AREAS: ReadonlyArray<{
  kind: SiteDesignKindName;
  to: string;
  label: string;
  icon: string;
  tile: 'clay' | 'iris' | 'ochre' | 'sand';
  blurb: string;
}> = [
  {
    kind: 'theme',
    to: '/design/theme',
    label: 'Theme',
    icon: 'palette',
    tile: 'clay',
    blurb: 'Colors, fonts and spacing. Every page and block uses them, so start here.',
  },
  {
    kind: 'page',
    to: '/design/pages',
    label: 'Pages',
    icon: 'doc',
    tile: 'iris',
    blurb: 'How each kind of page looks, for example an article or a landing page.',
  },
  {
    kind: 'block',
    to: '/design/blocks',
    label: 'Blocks',
    icon: 'blocks',
    tile: 'ochre',
    blurb: 'The sections editors stack on a page, like a hero or a teaser.',
  },
  {
    kind: 'layout',
    to: '/design/layouts',
    label: 'Layouts',
    icon: 'panels-top-left',
    tile: 'sand',
    blurb: 'The frame around every page: header with logo and menu, and the footer.',
  },
  {
    kind: 'menu',
    to: '/design/menus',
    label: 'Menus',
    icon: 'menu',
    tile: 'iris',
    blurb: 'How navigation looks: a bar, a dropdown, and what happens on phones.',
  },
  {
    kind: 'site',
    to: '/design/site',
    label: 'Site settings',
    icon: 'settings',
    tile: 'clay',
    blurb: 'Site name, logo, favicon, search engine texts and the 404 page.',
  },
];

/** Whether a status has changes to publish. */
export const isDirty = (status: DesignStatus): boolean =>
  status === 'unpublished' || status === 'changed';
