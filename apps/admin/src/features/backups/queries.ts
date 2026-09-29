import { api } from '@manablox/admin-sdk/lib/api';
import { responseError } from '@manablox/admin-sdk/lib/api-errors';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { type SpaceRef, useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';

export type { SnapshotList } from '@manablox/admin-sdk/lib/api-types';

/** The space's snapshots with the interval and window that apply. */
export function useSnapshots(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.snapshots.list, (id) => api.snapshots.list({ spaceId: id }), {
    spaceId,
  });
}

/** Snapshot writes, each refreshing what it changed. */
export const snapshots = {
  async create(spaceId: string) {
    const manifest = await api.snapshots.create({ spaceId });
    invalidate.snapshots(spaceId);
    return manifest;
  },

  /** Restores and switches to the restored space, which has a new id in both modes. */
  async restore(spaceId: string, snapshot: string, mode: 'new' | 'replace', confirm: string) {
    const result = await api.snapshots.restore({ spaceId, snapshot, mode, confirm });
    await useSessionStore().refresh();
    const store = useSpaceStore();
    await store.load();
    store.currentId = result.spaceId;
    invalidate.snapshots(result.spaceId);
    return result;
  },

  /** The export inside a snapshot. A plain fetch so the tab never holds it as a value. */
  async download(spaceId: string, snapshot: string): Promise<Blob> {
    const response = await fetch(`/transfer/snapshots/${spaceId}/${snapshot}`, {
      credentials: 'include',
    });
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },
};
