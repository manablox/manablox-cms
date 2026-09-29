import { DAY_MS } from '@manablox/core';
import type { ListingSnapshotStorage, SnapshotContext } from './context.js';
import { SNAPSHOT_PREFIX, spacePrefix, TRASH_PREFIX } from './layout.js';

/** How long a check for any snapshot is reused. */
const ANY_SNAPSHOTS_TTL_MS = 30_000;

/** A deleted asset's files, kept for restores until the longest snapshot retention passed. */
interface Tombstone {
  assetId: string;
  keys: string[];
  spaceIds: string[];
  deletedAt: string;
}

/** Deleted asset files kept for restores, and their purge once no snapshot can need them. */
export class SnapshotTrash {
  /** Whether any snapshot exists, briefly remembered while many orphans are deleted. */
  private anySnapshots: { until: number; value: Promise<boolean> } | null = null;

  constructor(private readonly ctx: SnapshotContext) {}

  /**
   * Keeps a deleted asset's files for restores when a snapshot could still need them: the
   * feature is on in one of its spaces and that space has an interval or snapshots. Writes a
   * tombstone and returns true; false means delete the files now.
   */
  async retainDeleted(asset: { id: string; keys: string[] }, spaceIds: string[]): Promise<boolean> {
    if (!this.ctx.supported || asset.keys.length === 0) return false;
    const storage = this.ctx.requireStorage();
    if (!(await this.snapshotsInUse(storage, spaceIds))) return false;
    const deletedAt = this.ctx.now();
    const tombstone: Tombstone = {
      assetId: asset.id,
      keys: asset.keys,
      spaceIds,
      deletedAt: deletedAt.toISOString(),
    };
    await storage.put(
      `${TRASH_PREFIX}${deletedAt.toISOString().slice(0, 10)}/${asset.id}.json`,
      Buffer.from(JSON.stringify(tombstone)),
      { contentType: 'application/json' },
    );
    return true;
  }

  private async snapshotsInUse(
    storage: ListingSnapshotStorage,
    spaceIds: string[],
  ): Promise<boolean> {
    // Assets of a deleted space: its snapshots outlive it.
    if (spaceIds.length === 0) {
      if (!this.anySnapshots || this.anySnapshots.until < Date.now()) {
        const value = storage.list(SNAPSHOT_PREFIX).then((objects) => objects.length > 0);
        this.anySnapshots = { until: Date.now() + ANY_SNAPSHOTS_TTL_MS, value };
        value.catch(() => {
          this.anySnapshots = null;
        });
      }
      return this.anySnapshots.value;
    }
    for (const spaceId of spaceIds) {
      const resolved = await this.ctx.manablox.controls.resolved(spaceId);
      if (!resolved.features.snapshots.enabled) continue;
      if (resolved.settings.snapshotsInterval) return true;
      if ((await storage.list(spacePrefix(spaceId))).length > 0) return true;
    }
    return false;
  }

  /**
   * Deletes kept files once the longest snapshot retention passed; an asset a restore brought
   * back keeps them. A `null` window anywhere keeps everything. Returns tombstones cleared.
   */
  async purgeTrash(now: Date = this.ctx.now()): Promise<number> {
    const storage = this.ctx.storage;
    if (!storage?.list) return 0;
    const objects = await storage.list(TRASH_PREFIX);
    if (objects.length === 0) return 0;
    const days = await this.longestRetention();
    if (days === null) return 0;
    const cutoff = now.getTime() - days * DAY_MS;

    const tombstones: Array<{ key: string; tombstone: Tombstone }> = [];
    for (const object of objects) {
      const tombstone = await storage
        .get(object.key)
        .then((body) => JSON.parse(body.toString('utf8')) as Tombstone)
        .catch(() => null);
      if (tombstone?.assetId && Array.isArray(tombstone.keys)) {
        tombstones.push({ key: object.key, tombstone });
      }
    }
    // An asset deleted, restored and deleted again goes by its newest tombstone.
    const newest = new Map<string, string>();
    for (const { tombstone } of tombstones) {
      const seen = newest.get(tombstone.assetId);
      if (!seen || seen < tombstone.deletedAt) newest.set(tombstone.assetId, tombstone.deletedAt);
    }

    let purged = 0;
    for (const { key, tombstone } of tombstones) {
      if (new Date(tombstone.deletedAt).getTime() >= cutoff) continue;
      const latest = newest.get(tombstone.assetId) === tombstone.deletedAt;
      const restored = await this.ctx.repos.assets.findById(tombstone.assetId);
      if (latest && !restored) {
        for (const file of tombstone.keys) await storage.delete(file);
      }
      await storage.delete(key);
      purged++;
    }
    return purged;
  }

  /** The longest `retention.snapshotsDays` of the instance and every space; `null` keeps all. */
  private async longestRetention(): Promise<number | null> {
    let longest = (await this.ctx.manablox.controls.resolved(null)).retention.snapshotsDays;
    if (longest === null) return null;
    for (const space of await this.ctx.repos.spaces.list()) {
      const days = (await this.ctx.manablox.controls.resolved(space.id)).retention.snapshotsDays;
      if (days === null) return null;
      longest = Math.max(longest, days);
    }
    return longest;
  }
}
