import { api } from '@manablox/admin-sdk/lib/api';
import { responseError } from '@manablox/admin-sdk/lib/api-errors';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { type SpaceRef, useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { SpaceRole } from '@manablox/core';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { type ConfigSelection, configPayload } from './config-kinds';
import { type ExportSection, type TransferSelection, transferPayload } from './transfer-sections';

export type { Space } from '@manablox/admin-sdk/lib/api-types';

/** Host names the public API answers the space on. */
export function useApiHosts(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.spaces.apiHosts, (id) => api.apiHosts.list({ spaceId: id }), {
    spaceId,
  });
}

export type ApiHost = Awaited<ReturnType<typeof api.apiHosts.list>>[number];

/** API host writes, each refreshing the list. */
export const apiHosts = {
  /** Into `environment`, else the open one. */
  async create(spaceId: string, hostname: string, environment?: string) {
    const row = await api.apiHosts.create({
      spaceId,
      hostname,
      ...(environment ? { environment } : {}),
    });
    invalidate.apiHosts(spaceId);
    return row;
  },
  async verify(spaceId: string, id: string) {
    const row = await api.apiHosts.verify({ spaceId, id });
    invalidate.apiHosts(spaceId);
    return row;
  },
  async remove(spaceId: string, id: string) {
    await api.apiHosts.delete({ spaceId, id });
    invalidate.apiHosts(spaceId);
  },
};

/** A space's members; disabled without a space. */
export function useMembers(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.spaces.members, (id) => api.spaces.members({ spaceId: id }), {
    spaceId,
  });
}

/** Non-members matching a search, fetched while the picker is open. */
export function useMemberCandidates(
  search: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.spaces.candidates(space, toValue(search)),
    (space) => {
      const term = toValue(search);
      return api.spaces.candidates({ spaceId: space, ...(term ? { search: term } : {}) });
    },
    { spaceId, enabled },
  );
}

/** A space's transfer inventory, fetched while the export panel is open. */
export function useTransferInventory(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.spaces.inventory, (id) => api.spaces.inventory({ spaceId: id }), {
    spaceId,
  });
}

/** A space's config inventory, fetched while the export panel is open. */
export function useConfigInventory(spaceId?: SpaceRef) {
  return useSpaceQuery(
    keys.spaces.configInventory,
    (id) => api.spaces.configInventory({ spaceId: id }),
    { spaceId },
  );
}

/** Membership writes, each with its invalidation. */
export const members = {
  async setRole(spaceId: string, userId: string, role: SpaceRole): Promise<void> {
    try {
      await api.spaces.grant({ spaceId, userId, role });
    } finally {
      // Even on failure, so the select reverts.
      invalidate.members(spaceId);
    }
  },
  async add(spaceId: string, userIds: string[], role: SpaceRole): Promise<number> {
    const result = await api.spaces.addMembers({ spaceId, userIds, role });
    invalidate.members(spaceId);
    return result.added;
  },
  async remove(spaceId: string, userId: string): Promise<void> {
    await api.spaces.revoke({ spaceId, userId });
    invalidate.members(spaceId);
  },
};

type SpaceCreateInput = Parameters<typeof api.spaces.create>[0];
type SpaceUpdateInput = Omit<Parameters<typeof api.spaces.update>[0], 'spaceId'>;
type AssetSettingsInput = Omit<Parameters<typeof api.spaces.setAssetSettings>[0], 'spaceId'>;

/** Space writes; each reloads the space list in the store, edits without the loading state. */
export const spaces = {
  async create(input: SpaceCreateInput) {
    const created = await api.spaces.create(input);
    await useSpaceStore().load();
    return created;
  },
  async update(spaceId: string, data: SpaceUpdateInput) {
    const saved = await api.spaces.update({ spaceId, ...data });
    // Without the loading state, so the open page is not replaced by the loader.
    await useSpaceStore().refresh();
    return saved;
  },
  async remove(spaceId: string): Promise<void> {
    await api.spaces.delete({ spaceId });
    const store = useSpaceStore();
    await store.load();
    if (store.currentId === spaceId) store.currentId = store.spaces[0]?.id ?? null;
  },
  async setAssetSettings(spaceId: string, input: AssetSettingsInput) {
    const saved = await api.spaces.setAssetSettings({ spaceId, ...input });
    invalidate.assets(spaceId);
    await useSpaceStore().refresh();
    return saved;
  },
  inventory(spaceId: string) {
    return api.spaces.inventory({ spaceId });
  },

  /** The space as JSON, or a zip with asset files. A plain fetch so the tab never holds it as a value. */
  async exportFile(spaceId: string, selection: TransferSelection): Promise<Blob> {
    const query = new URLSearchParams({ selection: archiveSelection(selection) });
    const response = await fetch(`/transfer/${spaceId}/export?${query}`, {
      credentials: 'include',
    });
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },
  /** The space's admin-built model as `manablox.config.ts` source. */
  exportConfig(spaceId: string, selection: ConfigSelection) {
    return api.spaces.configSource({ spaceId, selection: configPayload(selection) });
  },
  /**
   * Imports the selected part of an export file (JSON or archive, uploaded raw) and switches
   * to it. The space list refreshes meanwhile, so the arriving space shows its progress; a
   * failed import stays in the list for resume or delete.
   */
  async importFile(file: File, selection: TransferSelection) {
    const query = new URLSearchParams({ selection: archiveSelection(selection) });
    const store = useSpaceStore();
    const polling = pollUntilImporting(store);
    try {
      const response = await fetch(`/transfer/import?${query}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) throw await responseError(response);
      const result = (await response.json()) as TransferImportResult;
      await store.load();
      store.currentId = result.spaceId;
      return result;
    } finally {
      window.clearInterval(polling);
      await store.refresh();
    }
  },
  /** Continues an interrupted import from its staged file. */
  async resumeImport(spaceId: string) {
    const store = useSpaceStore();
    const polling = pollUntilImporting(store);
    try {
      const result = await api.spaces.resumeImport({ spaceId });
      await store.load();
      return result;
    } finally {
      window.clearInterval(polling);
      await store.refresh();
    }
  },
};

/** Refreshes the space list until it shows an import running; the store polls from there. */
function pollUntilImporting(store: ReturnType<typeof useSpaceStore>): number {
  return window.setInterval(() => {
    if (!store.spaces.some((space) => space.importStatus === 'importing')) void store.refresh();
  }, 1500);
}

/** The selection for the transfer routes: RPC shape, keeping `files`. */
function archiveSelection(selection: TransferSelection): string {
  return JSON.stringify({ ...transferPayload(selection), sections: selection.sections });
}

/** The import result; `sections` may name `files`. */
type TransferImportResult = Awaited<ReturnType<typeof api.spaces.import>> & {
  sections: ExportSection[];
};
