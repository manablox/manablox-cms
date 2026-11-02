import type { SiteMenu, SiteMenuItem } from '@manablox/site';
import { hostUrl } from './canvas';

/** How the site links a document: its permalink in a locale, `''` for the home page. */
export type SiteLink = (locale: string, permalink: string) => string;

export interface SiteLinkOptions {
  defaultLocale: string;
  localeStrategy: 'prefix' | 'domain';
  domains: ReadonlyArray<{ hostname: string; locale: string | null; isPrimary: boolean }>;
  /** The site process URL; local domains link on its port. */
  siteUrl?: string | null | undefined;
}

/**
 * Links as the site process builds them: the locale's own primary domain with the `domain`
 * strategy, else a path with every locale but the default as a prefix.
 */
export function siteLink(options: SiteLinkOptions): SiteLink {
  return (locale, permalink) => {
    const path = permalink
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    if (options.localeStrategy === 'domain') {
      const pinned = options.domains.find((row) => row.locale === locale && row.isPrimary);
      if (pinned) return `${hostUrl(pinned.hostname, options.siteUrl)}/${path}`;
    }
    const prefix = locale === options.defaultLocale ? '' : `/${encodeURIComponent(locale)}`;
    return path ? `${prefix}/${path}` : prefix || '/';
  };
}

/** An admin menu with its resolved entries, as the site renders it. */
export interface AdminMenuEntry {
  id: string;
  label: string | null;
  url: string | null;
  target: SiteMenuItem['target'];
  content: { id?: string; title: string; permalink: string | null } | null;
  children: AdminMenuEntry[];
}

/** A menu resolved in `locale`, its documents linked by `link`. */
export function toSiteMenu(
  menu: { id: string; name: string; machineName: string },
  items: readonly AdminMenuEntry[],
  currentPermalink: string | null = null,
  links: { locale: string; link: SiteLink; homeContentId?: string | null } | null = null,
): SiteMenu {
  const contentUrl = (content: NonNullable<AdminMenuEntry['content']>): string | null => {
    if (!links) return content.permalink ?? null;
    if (content.id && content.id === links.homeContentId) return links.link(links.locale, '');
    return content.permalink === null ? null : links.link(links.locale, content.permalink);
  };
  const convert = (entries: readonly AdminMenuEntry[]): SiteMenuItem[] =>
    entries.map((item) => {
      const children = convert(item.children);
      const url = item.content ? contentUrl(item.content) : item.url;
      const current =
        (currentPermalink !== null && item.content?.permalink === currentPermalink) ||
        children.some((child) => child.current);
      return {
        id: item.id,
        label: item.label?.trim() || item.content?.title || item.url || '',
        url,
        target: item.target,
        ...(current ? { current: true } : {}),
        children,
      };
    });
  return { id: menu.id, name: menu.name, machineName: menu.machineName, items: convert(items) };
}
