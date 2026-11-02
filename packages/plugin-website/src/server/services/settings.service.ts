import {
  type AuditChange,
  diffRecords,
  type EnvironmentNomination,
  type ErrorDetail,
  inScope,
  ManabloxError,
  purgeTags,
  type ResolvedScope,
  scopeSpaceId,
  stagingIdOf,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Repositories, type SpaceRow, whenCommitted } from '@manablox/db';
import {
  SITE_LOCALE_STRATEGIES,
  SITE_MODES,
  type SiteLocaleStrategy,
  type SiteMode,
  type SpaceSiteSettings,
  siteCacheTags,
  spaceSiteSettings,
  WEBSITE,
} from '../../shared/site.js';
import { settingsAuditor } from '../audit.js';
import { websiteKeys } from '../keys.js';

/** The site's 404 page: production's in the settings row, a staging environment's in its own. */
export const NOT_FOUND_NOMINATION: EnvironmentNomination = {
  key: 'notFoundContentId',
  plugin: WEBSITE,
  read: (data) => spaceSiteSettings(data).notFoundContentId,
  write: (data, id) => (id || data.notFoundContentId ? { ...data, notFoundContentId: id } : data),
};

/** The writable settings; `revision` moves only with design publishes. */
export interface SpaceSiteSettingsInput {
  mode?: SiteMode | undefined;
  localeStrategy?: SiteLocaleStrategy | undefined;
  notFoundContentId?: string | null | undefined;
  /** Argon2id hash of a new site password; `null` removes it. Needs the password feature. */
  passwordHash?: string | null | undefined;
}

/** The space's website settings, defaults filled in; the 404 page is the scope's own. */
export async function readSiteSettings(
  repos: Repositories,
  scope: string | ResolvedScope,
): Promise<SpaceSiteSettings> {
  const spaceId = scopeSpaceId(scope);
  const site = spaceSiteSettings(await repos.pluginSettings.get(spaceId, WEBSITE));
  const staging = stagingIdOf(scope);
  if (!staging) return site;
  const own = await repos.pluginSettings.get({ spaceId, environmentId: staging }, WEBSITE);
  const notFound = own?.notFoundContentId;
  return { ...site, notFoundContentId: typeof notFound === 'string' ? notFound : null };
}

/** Bumps the revision of a locked space and purges its site after commit. */
export async function bumpSiteRevision(
  manablox: Manablox,
  tx: Repositories,
  spaceId: string,
): Promise<number> {
  const stored = (await tx.pluginSettings.get(spaceId, WEBSITE)) ?? {};
  const revision = spaceSiteSettings(stored).revision + 1;
  await tx.pluginSettings.set(spaceId, WEBSITE, { ...stored, revision });
  await whenCommitted(tx, () => purgeTags(manablox, spaceId, [siteCacheTags.design(spaceId)]));
  return revision;
}

/** The password change as the audit log shows it: never the hash. */
function passwordChange(before: string | null, after: string | null): AuditChange[] {
  if (before === after) return [];
  return [
    {
      path: 'site.password',
      from: before ? 'set' : null,
      to: after ? (before ? 'changed' : 'set') : null,
    },
  ];
}

/** Website settings of a space: designed or external site, locale strategy, 404 page, password. */
export class SiteSettingsService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = settingsAuditor(repos);
  }

  async get(scope: string | ResolvedScope): Promise<SpaceSiteSettings> {
    await this.space(scopeSpaceId(scope));
    return readSiteSettings(this.repos, scope);
  }

  /**
   * Switches between designed and external site, the locale strategy, the 404 page and the
   * site password. A password is only set or removed while its feature is on.
   */
  async set(
    scope: string | ResolvedScope,
    input: SpaceSiteSettingsInput,
  ): Promise<SpaceSiteSettings> {
    const spaceId = scopeSpaceId(scope);
    // A staging environment keeps its own 404 page; the rest is the space's.
    const staging = stagingIdOf(scope);
    const space = await this.space(spaceId);
    const current = await readSiteSettings(this.repos, scope);
    const details: ErrorDetail[] = [];
    const invalid = 'plugins.website.settings.validation.failed';
    if (input.mode !== undefined && !SITE_MODES.includes(input.mode)) {
      details.push({ key: invalid, path: ['mode'], params: { mode: input.mode } });
    }
    if (
      input.localeStrategy !== undefined &&
      !SITE_LOCALE_STRATEGIES.includes(input.localeStrategy)
    ) {
      details.push({
        key: invalid,
        path: ['localeStrategy'],
        params: { localeStrategy: input.localeStrategy },
      });
    }
    if (input.notFoundContentId) {
      const row = await this.repos.content.findById(input.notFoundContentId);
      if (!row || !inScope(row, scope)) {
        details.push({
          key: 'content.notInSpace',
          path: ['notFoundContentId'],
          params: { id: input.notFoundContentId },
        });
      }
    }
    if (details.length) throw ManabloxError.validation(details, invalid);
    if (input.passwordHash !== undefined) {
      await this.manablox.controls.assertFeature(spaceId, websiteKeys.features.password);
    }

    const next: SpaceSiteSettings = {
      ...current,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.localeStrategy !== undefined ? { localeStrategy: input.localeStrategy } : {}),
      ...(input.notFoundContentId !== undefined
        ? { notFoundContentId: input.notFoundContentId }
        : {}),
      ...(input.passwordHash !== undefined ? { password: input.passwordHash } : {}),
    };
    return this.repos.transaction(async (tx) => {
      // Locked, so a concurrent design publish cannot lose its revision bump.
      await tx.spaces.lockById(spaceId);
      const stored = (await tx.pluginSettings.get(spaceId, WEBSITE)) ?? {};
      const revision = spaceSiteSettings(stored).revision;
      const { notFoundContentId, ...spaceWide } = next;
      const production: Record<string, unknown> = { ...stored, ...spaceWide, revision };
      if (!staging) production.notFoundContentId = notFoundContentId;
      await tx.pluginSettings.set(spaceId, WEBSITE, production);
      if (staging && input.notFoundContentId !== undefined) {
        const target = { spaceId, environmentId: staging };
        const own = (await tx.pluginSettings.get(target, WEBSITE)) ?? {};
        const { notFoundContentId: _previous, ...rest } = own;
        const data = notFoundContentId ? { ...rest, notFoundContentId } : rest;
        if (Object.keys(data).length) await tx.pluginSettings.set(target, WEBSITE, data);
        else await tx.pluginSettings.remove(target, WEBSITE);
      }
      await this.audit
        .in(tx)
        .record(
          'website.settings.update',
          space,
          [
            ...diffRecords(
              { site: { ...current, password: undefined } },
              { site: { ...next, password: undefined, revision } },
              { expand: ['site'] },
            ),
            ...passwordChange(current.password, next.password),
          ],
          staging ? { environmentId: staging } : null,
        );
      tx.afterCommit(() =>
        purgeTags(this.manablox, spaceId, [siteCacheTags.design(spaceId), siteCacheTags.domains]),
      );
      return { ...next, revision };
    });
  }

  private async space(spaceId: string): Promise<SpaceRow> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    return space;
  }
}
