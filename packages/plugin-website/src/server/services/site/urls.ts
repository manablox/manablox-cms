import type { SpaceSiteSettings } from '../../../shared/site.js';

/** Where a request landed: its locale and the path below the locale prefix. */
export interface SiteLocation {
  locale: string;
  /** Permalink form: no leading or trailing slash; `''` is the home page. */
  permalink: string;
}

export interface SiteSpaceInfo {
  defaultLocale: string;
  locales: readonly string[];
}

/** The host a request came in on, as the domains table knows it. */
export interface SiteHost {
  hostname: string;
  locale: string | null;
}

/**
 * Splits a request path into locale and permalink. A pinned host serves its locale without a
 * prefix; otherwise every locale but the default is a first path segment. The default locale
 * under its own prefix answers with the unprefixed path to redirect to.
 */
export function locateSitePath(
  space: SiteSpaceInfo,
  host: SiteHost,
  pathname: string,
): SiteLocation | { redirect: string } {
  const segments = decodeSegments(pathname);
  if (host.locale) return { locale: host.locale, permalink: segments.join('/') };
  const [first, ...rest] = segments;
  if (first && space.locales.includes(first)) {
    if (first === space.defaultLocale) {
      // Encoded, so a decoded `/` or `\` cannot make the target another host.
      return { redirect: `/${rest.map((segment) => encodeURIComponent(segment)).join('/')}` };
    }
    return { locale: first, permalink: rest.join('/') };
  }
  return { locale: space.defaultLocale, permalink: segments.join('/') };
}

/** Path segments, percent-decoded where valid, without empty ones. */
function decodeSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Builds the links of one site: which host serves a locale (a pinned primary domain with the
 * `domain` strategy, else the locale-less primary with a path prefix), and paths relative to
 * the current host where possible.
 */
export class SiteUrls {
  constructor(
    private readonly space: SiteSpaceInfo,
    private readonly settings: Pick<SpaceSiteSettings, 'localeStrategy'>,
    private readonly domains: ReadonlyArray<{
      hostname: string;
      locale: string | null;
      isPrimary: boolean;
    }>,
    private readonly current: SiteHost,
    private readonly protocol: string,
    /** Localization id of the home document; its path is the locale root. */
    private readonly homeLocalizationId: string | null,
    /** The request's port, kept on absolute links; empty for the scheme's default. */
    private readonly port = '',
  ) {}

  /** Host and path prefix a locale is served under. */
  target(locale: string): { hostname: string; prefix: string } {
    const prefix = locale === this.space.defaultLocale ? '' : `/${encodeURIComponent(locale)}`;
    if (this.current.locale === locale) return { hostname: this.current.hostname, prefix: '' };
    if (this.settings.localeStrategy === 'domain') {
      const pinned = this.domains.find((row) => row.locale === locale && row.isPrimary);
      if (pinned) return { hostname: pinned.hostname, prefix: '' };
    }
    const neutral = this.domains.find((row) => row.locale === null && row.isPrimary);
    if (neutral) return { hostname: neutral.hostname, prefix };
    return { hostname: this.current.hostname, prefix };
  }

  /** Path of a permalink in a locale, below its prefix. */
  path(locale: string, permalink: string): string {
    const { prefix } = this.target(locale);
    const encoded = permalink
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    if (!encoded) return prefix || '/';
    return `${prefix}/${encoded}`;
  }

  /** A link from the current page: relative on the same host, absolute elsewhere. */
  href(locale: string, permalink: string): string {
    const { hostname } = this.target(locale);
    const path = this.path(locale, permalink);
    return hostname === this.current.hostname ? path : `${this.host(hostname)}${path}`;
  }

  absolute(locale: string, permalink: string): string {
    const { hostname } = this.target(locale);
    return `${this.host(hostname)}${this.path(locale, permalink)}`;
  }

  /** The permalink a document is linked by: the root for the home document. */
  permalinkOf(row: { localizationId: string; permalink: string | null }): string | null {
    if (this.homeLocalizationId && row.localizationId === this.homeLocalizationId) return '';
    return row.permalink;
  }

  /** The origin a locale's sitemap and robots lines name. */
  origin(locale: string): string {
    return this.host(this.target(locale).hostname);
  }

  private host(hostname: string): string {
    return `${this.protocol}//${hostname}${this.port ? `:${this.port}` : ''}`;
  }
}

/** A delivered permalink (`about/team`), not yet a link. */
const isBarePermalink = (value: unknown): value is string =>
  typeof value === 'string' && !/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(value);

/**
 * Delivered fields with site links: related documents' `permalink` and internal link fields'
 * `href` become paths (or URLs) of this site, locale prefix included.
 */
export function withSiteLinks<T>(value: T, urls: SiteUrls, locale: string, depth = 0): T {
  if (depth > 64 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value))
    return value.map((entry) => withSiteLinks(entry, urls, locale, depth + 1)) as T;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record))
    out[key] = withSiteLinks(entry, urls, locale, depth + 1);
  if (record.mode === 'internal' && isBarePermalink(record.href)) {
    out.href = urls.href(locale, record.href);
  }
  if (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.locale === 'string' &&
    isBarePermalink(record.permalink)
  ) {
    out.permalink = urls.href(record.locale, record.permalink);
  }
  return out as T;
}
