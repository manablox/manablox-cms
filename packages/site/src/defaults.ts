import { neutralTheme } from './themes/neutral.js';
import type { MenuDesign, SiteSettingsDesign, ThemeDesign } from './types.js';
import { clone } from './util.js';

/** The theme a space starts with: the neutral starter theme. */
export function defaultTheme(): ThemeDesign {
  return clone(neutralTheme.theme);
}

export function defaultSiteSettings(): SiteSettingsDesign {
  return {
    name: '',
    logo: null,
    favicon: null,
    titlePattern: '{title} | {site}',
    meta: {},
    robots: { index: true },
    layouts: {},
  };
}

/** The neutral theme's design for a menu key, `main` for anything unknown. */
export function defaultMenuDesign(key = 'main'): MenuDesign {
  const menus = neutralTheme.menus;
  return clone(menus[key] ?? (menus.main as MenuDesign));
}
