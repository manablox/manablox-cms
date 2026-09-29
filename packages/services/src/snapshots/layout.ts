import type { Readable } from 'node:stream';
import type { SnapshotInterval } from '@manablox/core';

/** The storage snapshots and deleted asset files are kept in; a `StorageDriver` fits. */
export interface SnapshotStorage {
  put(key: string, body: Buffer | Readable, options: { contentType: string }): Promise<unknown>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Snapshots need it; a driver without it takes none. */
  list?(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date }>>;
}

/** `promote`: taken of production right before an environment is promoted. */
export type SnapshotTrigger = 'manual' | 'scheduled' | 'promote';

/** The small file next to each snapshot, read to list them. */
export interface SnapshotManifest {
  manabloxSnapshot: 1;
  /** The creation time as a key-safe stamp, e.g. `2026-09-25T10-15-00-000Z`. */
  id: string;
  spaceId: string;
  machineName: string;
  name: string;
  createdAt: string;
  trigger: SnapshotTrigger;
  /** `SPACE_EXPORT_VERSION` of the export inside. */
  formatVersion: number;
  /** Bytes of the compressed export. */
  size: number;
  counts: SnapshotCounts;
}

export interface SnapshotCounts {
  contentTypes: number;
  contents: number;
  assets: number;
  menus: number;
}

export const SNAPSHOT_PREFIX = 'snapshots/';

/** Deleted asset files kept for restores: `trash/<yyyy-mm-dd>/<assetId>.json`. */
export const TRASH_PREFIX = 'trash/';

const SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSnapshotId = (id: string): boolean => SNAPSHOT_ID.test(id);

/** `2026-09-25T10:15:00.000Z` as `2026-09-25T10-15-00-000Z`. */
export function snapshotId(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

/** The creation time a snapshot id stands for. */
export function snapshotDate(id: string): Date {
  return new Date(id.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
}

export const spacePrefix = (spaceId: string): string => `${SNAPSHOT_PREFIX}${spaceId}/`;
export const fileKey = (spaceId: string, id: string): string =>
  `${spacePrefix(spaceId)}${id}.json.gz`;
export const manifestKey = (spaceId: string, id: string): string =>
  `${spacePrefix(spaceId)}${id}.manifest.json`;

/** Space id and snapshot id of a manifest key; `null` for any other key. */
export function parseManifestKey(key: string): { spaceId: string; id: string } | null {
  const match = /^snapshots\/([^/]+)\/([^/]+)\.manifest\.json$/.exec(key);
  if (!match?.[1] || !match[2] || !UUID.test(match[1]) || !isSnapshotId(match[2])) return null;
  return { spaceId: match[1], id: match[2] };
}

/** How far apart scheduled snapshots are. */
export const SNAPSHOT_INTERVAL_MS: Record<SnapshotInterval, number> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/** A tick a little early still counts, so the schedule does not slip by a whole tick. */
export const SNAPSHOT_DUE_SLACK_MS = 5 * 60_000;

/** Whether a space with this interval and newest snapshot takes one now. */
export function snapshotDue(
  interval: SnapshotInterval | null,
  enabled: boolean,
  last: Date | null,
  now: Date,
): boolean {
  if (!enabled || !interval) return false;
  if (!last) return true;
  return now.getTime() - last.getTime() >= SNAPSHOT_INTERVAL_MS[interval] - SNAPSHOT_DUE_SLACK_MS;
}
