import { auditor, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ControlStore } from '../controls/store.js';
import type { SpaceService } from '../space.service.js';
import type { SpaceTransferService } from '../transfer/service.js';
import {
  isSnapshotId,
  manifestKey,
  type SnapshotManifest,
  type SnapshotStorage,
} from './layout.js';

export interface SnapshotServiceOptions {
  /** Purged after control settings move to a restored space. */
  controlStore?: Pick<ControlStore, 'invalidate'> | null | undefined;
  /** Deletes assets no space holds any more, after a replaced space is deleted. */
  purgeOrphaned?: (() => Promise<unknown>) | undefined;
  /** Runs once a restored space is ready, e.g. to apply code resources. */
  afterRestore?: ((spaceId: string) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

/** Storage that can list, which snapshots need. */
export type ListingSnapshotStorage = SnapshotStorage & Required<Pick<SnapshotStorage, 'list'>>;

type SpaceTarget = { id: string; name: string | null };

/** What the snapshot service's parts share: its dependencies, storage and manifest reads. */
export class SnapshotContext {
  readonly audit;

  constructor(
    readonly manablox: Manablox,
    readonly repos: Repositories,
    readonly spaces: SpaceService,
    readonly transfer: SpaceTransferService,
    readonly storage: SnapshotStorage | null,
    readonly options: SnapshotServiceOptions,
  ) {
    this.audit = auditor(repos, 'space', (space: SpaceTarget) => space.name, {
      spaceId: (space) => space.id,
    });
  }

  now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Whether this instance can keep snapshots at all. */
  get supported(): boolean {
    return Boolean(this.storage?.list);
  }

  requireStorage(): ListingSnapshotStorage {
    const storage = this.storage;
    if (!storage?.list) throw ManabloxError.badRequest('snapshot.unsupported');
    return storage as ListingSnapshotStorage;
  }

  /** One snapshot's manifest, or not found. */
  async manifest(spaceId: string, id: string): Promise<SnapshotManifest> {
    this.requireStorage();
    if (!isSnapshotId(id)) throw ManabloxError.notFound('snapshot.notFound', { id });
    const manifest = await this.readManifest(spaceId, id).catch(() => null);
    if (!manifest) throw ManabloxError.notFound('snapshot.notFound', { id });
    return manifest;
  }

  async readManifest(spaceId: string, id: string): Promise<SnapshotManifest | null> {
    const body = await this.requireStorage().get(manifestKey(spaceId, id));
    const manifest = JSON.parse(body.toString('utf8')) as SnapshotManifest;
    return manifest?.manabloxSnapshot === 1 && manifest.id === id ? manifest : null;
  }
}
