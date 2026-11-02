/** Designed-site vocabulary shared by the database, services and the API. Browser-safe. */

/** The plugin's id: its flag, rpc namespace, permission and table prefix. */
export const WEBSITE = 'website';

/** What a design document styles; mirrors `SiteDesignKind` of `@manablox/site`. */
export const SITE_DESIGN_KINDS = ['theme', 'block', 'page', 'layout', 'menu', 'site'] as const;
export type SiteDesignKindName = (typeof SITE_DESIGN_KINDS)[number];

/** `designed`: the site process renders the space; `external`: a code frontend does. */
export const SITE_MODES = ['designed', 'external'] as const;
export type SiteMode = (typeof SITE_MODES)[number];

/** `prefix`: every locale but the default under `/<locale>`; `domain`: domains pin locales. */
export const SITE_LOCALE_STRATEGIES = ['prefix', 'domain'] as const;
export type SiteLocaleStrategy = (typeof SITE_LOCALE_STRATEGIES)[number];

/** The website settings of a space, the plugin's settings row. */
export interface SpaceSiteSettings {
  mode: SiteMode;
  /** Bumped by every design publish; keys the site's caches. */
  revision: number;
  localeStrategy: SiteLocaleStrategy;
  /** Document rendered for a miss; a generated page when `null`. */
  notFoundContentId: string | null;
  /** Argon2id hash of the site password; the site is open when `null`. */
  password: string | null;
}

export const DEFAULT_SPACE_SITE_SETTINGS: Readonly<SpaceSiteSettings> = {
  mode: 'external',
  revision: 0,
  localeStrategy: 'prefix',
  notFoundContentId: null,
  password: null,
};

const oneOf = <T>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** Stored settings with defaults filled in; unknown or malformed values fall back. */
export function spaceSiteSettings(
  data: Record<string, unknown> | null | undefined,
): SpaceSiteSettings {
  const raw = data ?? {};
  const d = DEFAULT_SPACE_SITE_SETTINGS;
  return {
    mode: oneOf(SITE_MODES, raw.mode, d.mode),
    revision:
      typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0
        ? raw.revision
        : d.revision,
    localeStrategy: oneOf(SITE_LOCALE_STRATEGIES, raw.localeStrategy, d.localeStrategy),
    notFoundContentId: typeof raw.notFoundContentId === 'string' ? raw.notFoundContentId : null,
    password: typeof raw.password === 'string' && raw.password !== '' ? raw.password : null,
  };
}

/** Cache tags the site process reads under. */
export const siteCacheTags = {
  design: (spaceId: string) => `design:${spaceId}`,
  domains: 'domains',
  /** Every rendered site page of the instance. */
  pages: 'site:pages',
} as const;
