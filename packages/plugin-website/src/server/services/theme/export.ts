import { ManabloxError, type ResolvedScope, scopeSpaceId } from '@manablox/core';
import {
  defaultTheme,
  type SiteSettingsDesign,
  THEME_BUNDLE_FORMAT,
  THEME_BUNDLE_VERSION,
  type ThemeBundle,
  type ThemeBundleDesign,
  type ThemeDesign,
  withoutSiteCode,
} from '@manablox/site';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import { DEFAULT_KEY, type ThemeContext } from './context.js';
import { typeRef } from './design-types.js';

export interface ThemeExportOptions {
  variant?: 'published' | 'draft' | undefined;
  /** Include custom CSS, head and body code. */
  includeCode?: boolean | undefined;
}

/** The space's designs as a bundle; generated designs are implied and left out. */
export async function exportThemeBundle(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  options: ThemeExportOptions = {},
): Promise<ThemeBundle> {
  const spaceId = scopeSpaceId(scope);
  const space = await ctx.repos.spaces.findById(spaceId);
  if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
  const variant = options.variant ?? 'published';
  const rows = await websiteRepos(ctx.repos).designs.listBySpace(scope);
  const dataOf = (row: SiteDesignRow) => (variant === 'draft' ? row.draft : row.published);

  const themeRow = rows.find((row) => row.kind === 'theme' && row.key === DEFAULT_KEY);
  const siteRow = rows.find((row) => row.kind === 'site' && row.key === DEFAULT_KEY);
  const site = siteRow ? (dataOf(siteRow) as SiteSettingsDesign | null) : null;

  const designs: ThemeBundleDesign[] = [];
  for (const row of rows) {
    if (row.kind === 'theme' || row.kind === 'site') continue;
    const data = dataOf(row);
    if (data === null || data === undefined) continue;
    const entry = { kind: row.kind, key: row.key, data } as ThemeBundleDesign;
    if (row.name) entry.name = row.name;
    if (row.kind === 'block' || row.kind === 'page') {
      const type = ctx.manablox.contentTypes.tryGet(row.key);
      // Designs of deleted types have nothing to style elsewhere.
      if (!type) continue;
      entry.type = typeRef(type);
    }
    designs.push(entry);
  }

  return {
    format: THEME_BUNDLE_FORMAT,
    version: THEME_BUNDLE_VERSION,
    name: space.name,
    exportedAt: new Date().toISOString(),
    theme: ((themeRow && dataOf(themeRow)) as ThemeDesign | null) ?? defaultTheme(),
    designs,
    site: site && !options.includeCode ? withoutSiteCode(site) : site,
  };
}
