import {
  api,
  invalidate,
  keys,
  queryClient,
  required,
  type SpaceRef,
  useSpaceQuery,
} from '@manablox/admin-sdk';
import type { PageDesign, SiteSettingsDesign } from '@manablox/site';
import { type MaybeRefOrGetter, toValue } from 'vue';
import type { SiteDesignKindName, SiteLocaleStrategy, SiteMode } from '../sdk';
import { websiteApi } from './client';
import { designKeys, invalidateDesign } from './keys';
import { reassignPageLayout, reassignSiteLayouts } from './model/layout-design';
import { findBlockInstances } from './model/sample-data';

export type SiteDesignSummary = Awaited<ReturnType<typeof websiteApi.design.list>>[number];

/** Mode, revision and the site process origin of a space. */
export function useSiteSettings(spaceId?: SpaceRef) {
  return useSpaceQuery(designKeys.site, (id) => websiteApi.settings.get({ spaceId: id }), {
    spaceId,
  });
}

/** Every design the space has or implies, with its status. */
export function useSiteDesigns(spaceId?: SpaceRef) {
  return useSpaceQuery(designKeys.list, (id) => websiteApi.design.list({ spaceId: id }), {
    spaceId,
  });
}

/** One design with its draft; generated data while nothing is stored. */
export function useSiteDesign(
  kind: MaybeRefOrGetter<SiteDesignKindName>,
  key: MaybeRefOrGetter<string>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => designKeys.detail(space, toValue(kind), toValue(key)),
    (space) => websiteApi.design.get({ spaceId: space, kind: toValue(kind), key: toValue(key) }),
    { spaceId, enabled: () => Boolean(toValue(key)) },
  );
}

/** The data of several designs of one kind, e.g. every stored block design. */
export function useDesignsData(
  kind: MaybeRefOrGetter<SiteDesignKindName>,
  keys: MaybeRefOrGetter<readonly string[]>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => designKeys.many(space, toValue(kind), toValue(keys)),
    async (space) => {
      const entries = await Promise.all(
        toValue(keys).map((key) =>
          websiteApi.design.get({ spaceId: space, kind: toValue(kind), key }),
        ),
      );
      return Object.fromEntries(entries.map((entry) => [entry.key, entry.data]));
    },
    { spaceId, enabled: () => toValue(keys).length > 0 },
  );
}

/** Publish snapshots of a stored design, newest first. */
export function useDesignVersions(id: MaybeRefOrGetter<string | null>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => designKeys.versions(space, toValue(id)),
    (space) => websiteApi.design.versions({ spaceId: space, id: required(toValue(id)) }),
    { spaceId, enabled: () => Boolean(toValue(id)) },
  );
}

/** Host names of the site, for the preview link. */
export function useSiteDomains(enabled: MaybeRefOrGetter<boolean> = true, spaceId?: SpaceRef) {
  return useSpaceQuery(designKeys.domains, (id) => websiteApi.domains.list({ spaceId: id }), {
    spaceId,
    enabled,
  });
}

/**
 * Documents of `typeIds` holding blocks of `blockTypeId`, newest first, with those blocks.
 * Scans one page of documents; `term` narrows it by title.
 */
export function useBlockUsage(
  blockTypeId: MaybeRefOrGetter<string>,
  typeIds: MaybeRefOrGetter<readonly string[]>,
  locale: MaybeRefOrGetter<string>,
  term: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => designKeys.usage(space, toValue(blockTypeId), toValue(locale), toValue(term).trim()),
    async (space) => {
      const types = [...toValue(typeIds)];
      if (types.length === 0) return [];
      const search = toValue(term).trim();
      const page = await api.content.list({
        filter: {
          spaceId: space,
          locale: toValue(locale),
          typeIds: types,
          ...(search.length > 1 ? { search } : {}),
        },
        pagination: { limit: 50, offset: 0 },
        sort: [{ by: 'updatedAt', direction: 'desc' }],
      });
      return page.items
        .map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          blocks: findBlockInstances(row.fields, toValue(blockTypeId)),
        }))
        .filter((row) => row.blocks.length > 0);
    },
    { spaceId, enabled: () => Boolean(toValue(blockTypeId)) && toValue(enabled) },
  );
}

/** Stored site designs with their draft and live copies, for the content canvas. */
export function useCanvasDesigns(enabled: MaybeRefOrGetter<boolean>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => [...designKeys.all(space), 'content-canvas'],
    async (space) => {
      const list = await websiteApi.design.list({ spaceId: space });
      const stored = list.filter((entry) => entry.id !== null);
      const rows = await Promise.all(
        stored.map((entry) =>
          websiteApi.design.get({ spaceId: space, kind: entry.kind, key: entry.key }),
        ),
      );
      return rows.flatMap((row) =>
        row.design
          ? [
              {
                kind: row.kind,
                key: row.key,
                draft: row.design.draft,
                published: row.design.published,
              },
            ]
          : [],
      );
    },
    { spaceId, enabled },
  );
}

/** Every menu of the space with its entries resolved in `locale`, for the content canvas. */
export function useCanvasMenus(
  locale: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => [...keys.menus.all(space), 'content-canvas', toValue(locale)],
    async (space) => {
      const menus = await api.menus.list({ spaceId: space });
      return Promise.all(
        menus.map((menu) =>
          api.menus.get({ spaceId: space, id: menu.id, locale: toValue(locale) }),
        ),
      );
    },
    { spaceId, enabled },
  );
}

type SaveInput = Omit<Parameters<typeof websiteApi.design.saveDraft>[0], 'spaceId'>;
type FontInput = Omit<Parameters<typeof websiteApi.design.importGoogleFont>[0], 'spaceId'>;

/** Updates the cached detail without a refetch, so an autosave keeps the editor's state. */
function cacheSaved(spaceId: string, row: Awaited<ReturnType<typeof websiteApi.design.saveDraft>>) {
  queryClient.setQueryData(designKeys.detail(spaceId, row.kind, row.key), (before: unknown) =>
    before && typeof before === 'object'
      ? {
          ...before,
          design: row,
          data: row.draft,
          status:
            row.publishedVersion === row.version
              ? 'published'
              : row.publishedVersion === null
                ? 'unpublished'
                : 'changed',
        }
      : before,
  );
}

/** Design writes, each with its invalidation. */
export const design = {
  /** A signed link that opens a document's draft on the designed site. */
  shareLink(spaceId: string, contentId: string, expiresInSeconds: number) {
    return websiteApi.design.createShareLink({ spaceId, contentId, expiresInSeconds });
  },
  /** Stores a draft; `expectedVersion` is the version it was made from, `0` for a generated one. */
  async saveDraft(spaceId: string, input: SaveInput) {
    const row = await websiteApi.design.saveDraft({ spaceId, ...input });
    cacheSaved(spaceId, row);
    void queryClient.invalidateQueries({ queryKey: designKeys.list(spaceId) });
    void queryClient.invalidateQueries({ queryKey: designKeys.versions(spaceId, row.id) });
    void queryClient.invalidateQueries({ queryKey: designKeys.many(spaceId, row.kind, []) });
    return row;
  },
  async publish(spaceId: string, id: string) {
    const row = await websiteApi.design.publish({ spaceId, id });
    invalidateDesign(spaceId);
    void queryClient.invalidateQueries({ queryKey: designKeys.site(spaceId) });
    return row;
  },
  async publishAll(spaceId: string) {
    const result = await websiteApi.design.publishAll({ spaceId });
    invalidateDesign(spaceId);
    void queryClient.invalidateQueries({ queryKey: designKeys.site(spaceId) });
    return result;
  },
  async discardDraft(spaceId: string, id: string) {
    const row = await websiteApi.design.discardDraft({ spaceId, id });
    invalidateDesign(spaceId);
    return row;
  },
  async restore(spaceId: string, id: string, versionId: string) {
    const row = await websiteApi.design.restore({ spaceId, id, versionId });
    invalidateDesign(spaceId);
    return row;
  },
  /** Resets a design to the generated one, live copy included. */
  async reset(spaceId: string, id: string) {
    await websiteApi.design.delete({ spaceId, id });
    invalidateDesign(spaceId);
    void queryClient.invalidateQueries({ queryKey: designKeys.site(spaceId) });
  },
  /**
   * Removes a layout after moving what uses it to layout `to`: page designs that pick it and
   * the site settings' assignments, as drafts.
   */
  async deleteLayout(spaceId: string, input: { id: string; key: string; to: string }) {
    const list = await websiteApi.design.list({ spaceId });
    for (const entry of list) {
      if (entry.kind !== 'page' || entry.id === null) continue;
      const current = await websiteApi.design.get({ spaceId, kind: 'page', key: entry.key });
      const data = current.data as PageDesign | null;
      if (!data || !current.design || data.layout !== input.key) continue;
      await design.saveDraft(spaceId, {
        kind: 'page',
        key: entry.key,
        draft: reassignPageLayout(data, input.key, input.to),
        expectedVersion: current.design.version,
      });
    }
    const site = await websiteApi.design.get({ spaceId, kind: 'site', key: 'default' });
    const settings = site.data as SiteSettingsDesign | null;
    if (settings && Object.values(settings.layouts ?? {}).includes(input.key)) {
      await design.saveDraft(spaceId, {
        kind: 'site',
        key: 'default',
        draft: reassignSiteLayouts(settings, input.key, input.to),
        expectedVersion: site.design?.version ?? 0,
      });
    }
    await design.reset(spaceId, input.id);
  },
  /** A signed, time-limited token for a draft preview on the site. */
  async shareToken(spaceId: string) {
    const { token } = await websiteApi.design.createShareLink({ spaceId });
    return token;
  },
  /** Downloads a Google Fonts family into the space's assets; returns its theme entry. */
  async importGoogleFont(spaceId: string, input: FontInput) {
    const family = await websiteApi.design.importGoogleFont({ spaceId, ...input });
    invalidate.assets(spaceId);
    return family;
  },
  /** Switches the site mode; `themes.switchToDesigned` applies a starter first. */
  async setMode(spaceId: string, mode: SiteMode) {
    const result = await websiteApi.settings.set({ spaceId, mode });
    invalidateDesign(spaceId);
    invalidate.spaces([spaceId]);
    return result;
  },
};

export type SiteDomain = Awaited<ReturnType<typeof websiteApi.domains.list>>[number];

type DomainInput = Omit<Parameters<typeof websiteApi.domains.create>[0], 'spaceId'>;

/** Domains and space-level site settings, each with its invalidation. */
export const site = {
  async createDomain(spaceId: string, input: DomainInput) {
    const row = await websiteApi.domains.create({ spaceId, ...input });
    invalidateDesign(spaceId);
    return row;
  },
  async updateDomain(spaceId: string, id: string, input: Partial<DomainInput>) {
    const row = await websiteApi.domains.update({ spaceId, id, ...input });
    invalidateDesign(spaceId);
    return row;
  },
  /** Checks the domain's DNS record now. */
  async verifyDomain(spaceId: string, id: string) {
    const row = await websiteApi.domains.verify({ spaceId, id });
    invalidateDesign(spaceId);
    return row;
  },
  async deleteDomain(spaceId: string, id: string) {
    await websiteApi.domains.delete({ spaceId, id });
    invalidateDesign(spaceId);
  },
  /** Locale strategy and 404 page; stored on the space, live at once. */
  async setSettings(
    spaceId: string,
    input: { localeStrategy?: SiteLocaleStrategy; notFoundContentId?: string | null },
  ) {
    const result = await websiteApi.settings.set({ spaceId, ...input });
    void queryClient.invalidateQueries({ queryKey: designKeys.site(spaceId) });
    return result;
  },
  /** Sets or, with `null`, removes the site password; live at once. */
  async setPassword(spaceId: string, password: string | null) {
    const result = await websiteApi.settings.set({ spaceId, password });
    void queryClient.invalidateQueries({ queryKey: designKeys.site(spaceId) });
    return result;
  },
};

export type ThemeImportReport = Awaited<ReturnType<typeof websiteApi.design.previewThemeImport>>;
export type ThemeImportEntry = ThemeImportReport['entries'][number];
export type AiThemeResult = Awaited<ReturnType<typeof websiteApi.design.aiTheme>>;
export type AiBlockDesignResult = Awaited<ReturnType<typeof websiteApi.design.aiBlockDesign>>;

type ImportOptions = { replace: boolean; skip: string[] };
type AiThemeInput = Omit<Parameters<typeof websiteApi.design.aiTheme>[0], 'spaceId'>;
type AiBlockInput = Omit<Parameters<typeof websiteApi.design.aiBlockDesign>[0], 'spaceId'>;

/** The starter gallery: built-in themes, then code themes for this space. */
export function useStarterThemes(spaceId?: SpaceRef, enabled: MaybeRefOrGetter<boolean> = true) {
  return useSpaceQuery(
    (space) => [...designKeys.all(space), 'starters'],
    (space) => websiteApi.design.starterThemes({ spaceId: space }),
    // Changes only with a deploy.
    { spaceId, enabled, staleTime: 5 * 60_000 },
  );
}

/** Theme bundles, the starter gallery and AI proposals. Writes land as drafts. */
export const themes = {
  /** The space's designs as a bundle, `published` or `draft`. */
  export: (spaceId: string, variant: 'published' | 'draft') =>
    websiteApi.design.exportTheme({ spaceId, variant }),
  /** What importing `bundle` would do; writes nothing. */
  previewImport: (spaceId: string, bundle: unknown, options: ImportOptions) =>
    websiteApi.design.previewThemeImport({ spaceId, bundle, ...options }),
  async import(spaceId: string, bundle: unknown, options: ImportOptions) {
    const report = await websiteApi.design.importTheme({ spaceId, bundle, ...options });
    invalidateDesign(spaceId);
    return report;
  },
  async applyStarter(spaceId: string, id: string, replace: boolean) {
    const report = await websiteApi.design.applyStarter({ spaceId, id, replace });
    invalidateDesign(spaceId);
    return report;
  },
  /**
   * Switches to a designed site, first writing `starterId` over stored drafts, with the
   * layout, menus and block and page designs of `preset` when one is named.
   */
  async switchToDesigned(spaceId: string, starterId: string | null, preset?: string | null) {
    if (starterId)
      await websiteApi.design.applyStarter({
        spaceId,
        id: starterId,
        replace: true,
        ...(preset ? { preset } : {}),
      });
    return design.setMode(spaceId, 'designed');
  },
  /** Theme tokens proposed from a prompt or brand color; saves nothing. */
  aiTheme: (spaceId: string, input: AiThemeInput) =>
    websiteApi.design.aiTheme({ spaceId, ...input }),
  /** A block design proposed from a prompt; saves nothing. */
  aiBlockDesign: (spaceId: string, input: AiBlockInput) =>
    websiteApi.design.aiBlockDesign({ spaceId, ...input }),
};
