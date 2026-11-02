import { isSpaceReady, type ResolvedScope, spacePurgeTag, stagingIdOf } from '@manablox/core';
import { normaliseHostname } from '@manablox/services';
import {
  type SpaceSiteSettings,
  siteCacheTags,
  spaceSiteSettings,
  WEBSITE,
} from '../../../shared/site.js';
import { websiteRepos } from '../../db/index.js';
import type { ResolvedHost } from '../domain.service.js';
import { readSiteSettings } from '../settings.service.js';
import type { SiteDomainEntry, SiteLoaderContext, SiteLookup, SiteSpace } from './context.js';

/** A space as cached for site requests, with its readiness and site settings. */
export type CachedSiteSpace = SiteSpace & { ready: boolean; site: SpaceSiteSettings };

/** Seconds a host's lookup is kept in process; purges of its tags drop it sooner. */
export const LOOKUP_TTL_MS = 5_000;
export const LOOKUPS_KEPT = 1_000;

/** A host's lookup before the per-request checks, with what purges it. */
export interface KeptLookup {
  found: SiteLookup;
  /** Served only while `environments` is on. */
  staging: boolean;
}

/**
 * What a `Host` header names: host, space, environment and domains. Kept in process for a
 * few seconds and dropped by any purge of the domains, the space, its design or the
 * environment (in every process, see `localCache`); behind that the shared cache holds
 * host, space and domains. A staging environment's host needs `environments`; while it is
 * off the host is unknown.
 */
export async function lookupSite(ctx: SiteLoaderContext, hostHeader: string): Promise<SiteLookup> {
  const kept = await ctx.lookups.load(hostHeader, async () => {
    const value = await readSite(ctx, hostHeader);
    return { value, tags: lookupTags(value) };
  });
  if (!kept.staging || kept.found.kind === 'unknown' || kept.found.kind === 'moved') {
    return kept.found;
  }
  const spaceId = kept.found.kind === 'site' ? kept.found.context.space.id : kept.found.spaceId;
  const feature = await ctx.options.manablox.controls.feature(spaceId, 'environments');
  return feature.enabled ? kept.found : { kind: 'unknown' };
}

/** The tags whose purge makes a kept lookup stale. */
function lookupTags({ found }: KeptLookup): string[] {
  if (found.kind === 'unknown' || found.kind === 'moved') return [siteCacheTags.domains];
  const spaceId = found.kind === 'site' ? found.context.space.id : found.spaceId;
  const tags = [siteCacheTags.domains, siteCacheTags.design(spaceId), `space:${spaceId}`];
  if (found.kind === 'site') tags.push(spacePurgeTag(found.context.scope));
  return tags;
}

async function readSite(ctx: SiteLoaderContext, hostHeader: string): Promise<KeptLookup> {
  const { repos } = ctx.options;
  const unknown: KeptLookup = { found: { kind: 'unknown' }, staging: false };
  const host = await resolveHost(ctx, hostHeader);
  if (!host) return unknown;
  if (host.redirectTo)
    return { found: { kind: 'moved', hostname: host.redirectTo }, staging: false };
  const space = await cachedSpace(ctx, host.spaceId);
  if (!space) return unknown;
  const scope = await repos.environments.resolve({
    spaceId: host.spaceId,
    environmentId: host.environmentId,
  });
  if (!scope) return unknown;
  const staging = !scope.production;
  const { site } = space;
  if (!space.ready || site.mode !== 'designed') {
    return { found: { kind: 'hidden', spaceId: space.id }, staging };
  }
  // A staging environment nominates its own 404 page.
  const settings = scope.production ? site : await readSiteSettings(repos, scope);
  const domains = await spaceDomains(ctx, scope);
  const { ready: _ready, site: _site, ...rest } = space;
  const port = portOf(hostHeader);
  return {
    found: { kind: 'site', context: { host, scope, port, space: rest, settings, domains } },
    staging,
  };
}

export async function resolveHost(
  ctx: SiteLoaderContext,
  hostHeader: string,
): Promise<ResolvedHost | null> {
  const { cache, domains, ttl } = ctx.options;
  // Normalised first, so odd spellings of a host share one cache entry.
  const hostname = hostHeader.length > 300 ? null : normaliseHostname(hostHeader);
  if (!hostname) return null;
  const key = `site:host:${hostname}`;
  const cached = await cache.get<{ host: ResolvedHost | null }>(key);
  if (cached) return cached.host;
  const host = await domains.resolveHost(hostname);
  await cache.set(key, { host }, { ttl, tags: [siteCacheTags.domains] });
  return host;
}

export async function cachedSpace(
  ctx: SiteLoaderContext,
  spaceId: string,
): Promise<CachedSiteSpace | null> {
  const { cache, repos, ttl } = ctx.options;
  const key = `site:space:${spaceId}`;
  const cached = await cache.get<{ space: CachedSiteSpace | null }>(key);
  if (cached) return cached.space;
  const row = await repos.spaces.findById(spaceId);
  const space = row
    ? {
        id: row.id,
        name: row.name,
        defaultLocale: row.defaultLocale,
        locales: row.locales.includes(row.defaultLocale)
          ? row.locales
          : [row.defaultLocale, ...row.locales],
        settings: row.settings,
        ready: isSpaceReady(row),
        site: spaceSiteSettings(await repos.pluginSettings.get(row.id, WEBSITE)),
      }
    : null;
  await cache.set(
    key,
    { space },
    { ttl, tags: [siteCacheTags.design(spaceId), `space:${spaceId}`, siteCacheTags.domains] },
  );
  return space;
}

/** The environment's domains. */
async function spaceDomains(
  ctx: SiteLoaderContext,
  scope: ResolvedScope,
): Promise<SiteDomainEntry[]> {
  const { cache, repos, domains: service, ttl } = ctx.options;
  const staging = stagingIdOf(scope);
  const key = `site:domains:${scope.spaceId}${staging ? `:${staging}` : ''}`;
  const cached = await cache.get<{ domains: SiteDomainEntry[] }>(key);
  if (cached) return cached.domains;
  // Unverified hosts are not served, so links never point at them.
  const required = await service.verifier.required();
  const domains = (await websiteRepos(repos).domains.listBySpace(scope))
    .filter((row) => row.verifiedAt !== null || !required)
    .map((row) => ({ hostname: row.hostname, locale: row.locale, isPrimary: row.isPrimary }));
  await cache.set(key, { domains }, { ttl, tags: [siteCacheTags.domains] });
  return domains;
}

/** The port a `Host` header names, when it is a valid one. */
function portOf(hostHeader: string): string {
  const port = /:(\d{1,5})$/.exec(hostHeader.trim())?.[1];
  if (!port) return '';
  const value = Number(port);
  return value >= 1 && value <= 65535 ? String(value) : '';
}
