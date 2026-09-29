import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createGunzip, gzip } from 'node:zlib';
import { type ControlScope, DAY_MS, ManabloxError, type ResolvedControls } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceRow } from '@manablox/db';
import type { ControlStore } from '../controls/store.js';
import type { SpaceService } from '../space.service.js';
import { SPACE_EXPORT_VERSION } from '../transfer/format.js';
import type { SpaceTransferService } from '../transfer/service.js';
import { SnapshotContext, type SnapshotServiceOptions } from './context.js';
import {
  fileKey,
  manifestKey,
  parseManifestKey,
  SNAPSHOT_PREFIX,
  type SnapshotManifest,
  type SnapshotStorage,
  type SnapshotTrigger,
  snapshotDate,
  snapshotDue,
  snapshotId,
  spacePrefix,
} from './layout.js';
import {
  type SnapshotRestoreMode,
  type SnapshotRestoreResult,
  SnapshotRestores,
} from './restore.js';
import { SnapshotTrash } from './trash.js';

export type { SnapshotServiceOptions } from './context.js';
export type { SnapshotRestoreMode, SnapshotRestoreResult } from './restore.js';

const gzipAsync = promisify(gzip);

/** Manifests read at once when listing. */
const READ_CONCURRENCY = 8;

export interface SnapshotTickReport {
  created: number;
  failed: number;
  pruned: number;
  purged: number;
}

/**
 * Space snapshots: an export without asset bytes under `snapshots/<spaceId>/`, a manifest
 * beside it, a schedule, pruning, restores, and deleted asset files kept for those restores.
 */
export class SnapshotService {
  private readonly ctx: SnapshotContext;
  private readonly restores: SnapshotRestores;
  private readonly trash: SnapshotTrash;
  /** One snapshot at a time in this process. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    manablox: Manablox,
    repos: Repositories,
    spaces: SpaceService,
    transfer: SpaceTransferService,
    storage: SnapshotStorage | null,
    options: SnapshotServiceOptions = {},
  ) {
    this.ctx = new SnapshotContext(manablox, repos, spaces, transfer, storage, options);
    this.restores = new SnapshotRestores(this.ctx);
    this.trash = new SnapshotTrash(this.ctx);
  }

  private now(): Date {
    return this.ctx.now();
  }

  /** Whether this instance can keep snapshots at all. */
  get supported(): boolean {
    return this.ctx.supported;
  }

  /** The space's snapshots, newest first. */
  async list(spaceId: string): Promise<SnapshotManifest[]> {
    const storage = this.ctx.requireStorage();
    const keys = (await storage.list(spacePrefix(spaceId)))
      .map((object) => parseManifestKey(object.key))
      .filter((entry): entry is { spaceId: string; id: string } => entry?.spaceId === spaceId);
    const manifests: SnapshotManifest[] = [];
    for (let start = 0; start < keys.length; start += READ_CONCURRENCY) {
      const batch = keys.slice(start, start + READ_CONCURRENCY);
      const read = await Promise.all(
        batch.map((entry) => this.ctx.readManifest(entry.spaceId, entry.id).catch(() => null)),
      );
      for (const manifest of read) if (manifest) manifests.push(manifest);
    }
    return manifests.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  /** One snapshot's manifest, or not found. */
  manifest(spaceId: string, id: string): Promise<SnapshotManifest> {
    return this.ctx.manifest(spaceId, id);
  }

  /** The export inside a snapshot, uncompressed, as a stream. */
  async open(
    spaceId: string,
    id: string,
  ): Promise<{ manifest: SnapshotManifest; stream: Readable }> {
    const manifest = await this.manifest(spaceId, id);
    const source = await this.ctx.requireStorage().stream(fileKey(spaceId, id));
    return { manifest, stream: source.pipe(createGunzip()) };
  }

  /**
   * Takes a snapshot now. Snapshots run one at a time per process and, through a lock, per
   * database. Emits `snapshot.completed` or `snapshot.failed`.
   */
  async create(
    spaceId: string,
    options: { trigger?: SnapshotTrigger; actorId?: string | null } = {},
  ): Promise<SnapshotManifest> {
    const trigger = options.trigger ?? 'manual';
    await this.ctx.manablox.controls.assertFeature(spaceId, 'snapshots');
    const storage = this.ctx.requireStorage();
    const space = await this.ctx.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    if (space.importStatus) throw ManabloxError.conflict('space.importing', { spaceId });

    const run = () =>
      this.ctx.repos.locks.withLock('snapshots', () => this.write(storage, space, trigger));
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    const manifest = await next;
    if (trigger === 'manual') {
      await this.ctx.audit.record('space.snapshot', space, undefined, {
        snapshot: manifest.id,
        size: manifest.size,
      });
    }
    return manifest;
  }

  private async write(
    storage: SnapshotStorage,
    space: SpaceRow,
    trigger: SnapshotTrigger,
  ): Promise<SnapshotManifest> {
    const scope: ControlScope = { kind: 'space', id: space.id };
    const createdAt = this.now();
    const id = snapshotId(createdAt);
    const file = fileKey(space.id, id);
    try {
      const payload = await this.ctx.transfer.export(space.id);
      const captured = await this.ctx.transfer.snapshotState(space.id);
      if (captured) payload.snapshots = captured;
      const body = await gzipAsync(Buffer.from(JSON.stringify(payload)));
      await storage.put(file, body, { contentType: 'application/gzip' });
      const manifest: SnapshotManifest = {
        manabloxSnapshot: 1,
        id,
        spaceId: space.id,
        machineName: space.machineName,
        name: space.name,
        createdAt: createdAt.toISOString(),
        trigger,
        formatVersion: SPACE_EXPORT_VERSION,
        size: body.byteLength,
        counts: {
          contentTypes: payload.contentTypes?.length ?? 0,
          contents: payload.contents?.length ?? 0,
          assets: payload.assets?.length ?? 0,
          menus: payload.menus?.length ?? 0,
        },
      };
      await storage.put(manifestKey(space.id, id), Buffer.from(JSON.stringify(manifest)), {
        contentType: 'application/json',
      });
      await this.ctx.manablox.controls.emit('snapshot.completed', scope, {
        spaceId: space.id,
        snapshot: id,
        trigger,
        size: manifest.size,
        createdAt: manifest.createdAt,
      });
      return manifest;
    } catch (error) {
      await storage.delete(file).catch(() => {});
      this.ctx.manablox.logger.error({ err: error, spaceId: space.id, trigger }, 'snapshot failed');
      await this.ctx.manablox.controls.emit('snapshot.failed', scope, {
        spaceId: space.id,
        trigger,
        error: ManabloxError.is(error) ? error.key : 'internal.error',
      });
      throw error;
    }
  }

  /** Spaces whose interval says a scheduled snapshot is due. */
  async due(now: Date = this.now(), listed?: readonly SnapshotObject[]): Promise<string[]> {
    if (!this.supported) return [];
    const newest = newestPerSpace(listed ?? (await this.listSnapshots()));
    const out: string[] = [];
    const spaces = (await this.ctx.repos.spaces.list()).filter((space) => !space.importStatus);
    const controls = await this.controls.resolvedEach(spaces);
    for (const space of spaces) {
      const resolved = controls.get(space.id) as ResolvedControls;
      const last = newest.get(space.id);
      if (
        snapshotDue(
          resolved.settings.snapshotsInterval,
          resolved.features.snapshots.enabled,
          last ? snapshotDate(last) : null,
          now,
        )
      ) {
        out.push(space.id);
      }
    }
    return out;
  }

  /** The maintenance tick: due snapshots, then pruning and the purge of kept files. */
  async tick(now: Date = this.now()): Promise<SnapshotTickReport> {
    const report: SnapshotTickReport = { created: 0, failed: 0, pruned: 0, purged: 0 };
    if (!this.supported) return report;
    // One listing serves both passes; a snapshot taken in between is too new to prune.
    const listed = await this.listSnapshots();
    for (const spaceId of await this.due(now, listed)) {
      try {
        await this.create(spaceId, { trigger: 'scheduled' });
        report.created++;
      } catch {
        // Logged and reported as `snapshot.failed`.
        report.failed++;
      }
    }
    report.pruned = await this.prune(now, listed);
    report.purged = await this.purgeTrash(now);
    return report;
  }

  /**
   * Deletes snapshots older than `retention.snapshotsDays`; a deleted space's go by the
   * instance's window. Returns how many were deleted.
   */
  async prune(now: Date = this.now(), listed?: readonly SnapshotObject[]): Promise<number> {
    const storage = this.ctx.storage;
    if (!storage?.list) return 0;
    const objects = listed ?? (await storage.list(SNAPSHOT_PREFIX));
    const bySpace = new Map<string, string[]>();
    for (const object of objects) {
      const entry = parseManifestKey(object.key);
      if (entry) bySpace.set(entry.spaceId, [...(bySpace.get(entry.spaceId) ?? []), entry.id]);
    }
    const existing = await this.controls.resolvedEach(
      await this.ctx.repos.spaces.listByIds([...bySpace.keys()]),
    );
    // A deleted space's snapshots go by the instance's window.
    const instance = await this.ctx.manablox.controls.resolved(null);
    let pruned = 0;
    for (const [spaceId, ids] of bySpace) {
      const days = (existing.get(spaceId) ?? instance).retention.snapshotsDays;
      if (days === null) continue;
      const cutoff = now.getTime() - days * DAY_MS;
      for (const id of ids) {
        if (snapshotDate(id).getTime() >= cutoff) continue;
        await storage.delete(fileKey(spaceId, id));
        await storage.delete(manifestKey(spaceId, id));
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Restores a snapshot as a new space, or in place of its space: the copy is imported beside
   * it, then takes over machine name, hosts, group, control settings and snapshots, and the
   * old space is deleted. Members of the space come along; `actorId` becomes owner.
   */
  restore(
    spaceId: string,
    id: string,
    options: { mode: SnapshotRestoreMode; actorId?: string | null },
  ): Promise<SnapshotRestoreResult> {
    return this.restores.restore(spaceId, id, options);
  }

  /**
   * Keeps a deleted asset's files for restores when a snapshot could still need them: the
   * feature is on in one of its spaces and that space has an interval or snapshots. Writes a
   * tombstone and returns true; false means delete the files now.
   */
  retainDeleted(asset: { id: string; keys: string[] }, spaceIds: string[]): Promise<boolean> {
    return this.trash.retainDeleted(asset, spaceIds);
  }

  /**
   * Deletes kept files once the longest snapshot retention passed; an asset a restore brought
   * back keeps them. A `null` window anywhere keeps everything. Returns tombstones cleared.
   */
  purgeTrash(now: Date = this.now()): Promise<number> {
    return this.trash.purgeTrash(now);
  }

  private listSnapshots(): Promise<SnapshotObject[]> {
    return this.ctx.requireStorage().list(SNAPSHOT_PREFIX);
  }

  /** Resolves many spaces at once where the controls can (`ControlStore`). */
  private get controls(): Pick<ControlStore, 'resolvedEach'> {
    const controls = this.ctx.manablox.controls as Partial<ControlStore>;
    if (controls.resolvedEach) return controls as ControlStore;
    const each = async (spaces: ReadonlyArray<{ id: string }>) => {
      const out = new Map<string, ResolvedControls>();
      for (const space of spaces)
        out.set(space.id, await this.ctx.manablox.controls.resolved(space.id));
      return out;
    };
    return { resolvedEach: each };
  }
}

/** An object a snapshot listing holds. */
type SnapshotObject = { key: string };

/** The newest snapshot id per space. */
function newestPerSpace(objects: readonly SnapshotObject[]): Map<string, string> {
  const newest = new Map<string, string>();
  for (const object of objects) {
    const entry = parseManifestKey(object.key);
    if (!entry) continue;
    const seen = newest.get(entry.spaceId);
    if (!seen || seen < entry.id) newest.set(entry.spaceId, entry.id);
  }
  return newest;
}
