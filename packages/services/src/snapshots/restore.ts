import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { type ControlScope, ManabloxError, purgeTags, type SpaceRole } from '@manablox/core';
import type { SpaceRow, TransactionRepositories } from '@manablox/db';
import { API_HOST_SOURCE } from '../api-host.service.js';
import { controlScopeTag } from '../controls/store.js';
import {
  credentialsRestoredHooks,
  hostSources,
  snapshotProviders,
  transferProviders,
} from '../data/registry.js';
import type { ImportResult, SpaceExport } from '../transfer/format.js';
import type { SnapshotContext } from './context.js';
import {
  fileKey,
  manifestKey,
  parseManifestKey,
  type SnapshotManifest,
  spacePrefix,
} from './layout.js';
import { remapExportIds } from './remap.js';

const gunzipAsync = promisify(gunzip);

export type SnapshotRestoreMode = 'new' | 'replace';

export interface SnapshotRestoreResult {
  mode: SnapshotRestoreMode;
  snapshot: string;
  /** The space the snapshot was taken of. */
  sourceSpaceId: string;
  /** The restored space. */
  spaceId: string;
  machineName: string;
  /** `replace` only: whether the replaced space was deleted. */
  replacedDeleted: boolean;
  import: ImportResult;
}

/** Restores of snapshots, as a new space or in place of their space. */
export class SnapshotRestores {
  constructor(private readonly ctx: SnapshotContext) {}

  /**
   * Restores a snapshot as a new space, or in place of its space: the copy is imported beside
   * it, then takes over machine name, hosts, group, control settings and snapshots, and the
   * old space is deleted. Members of the space come along; `actorId` becomes owner.
   */
  async restore(
    spaceId: string,
    id: string,
    options: { mode: SnapshotRestoreMode; actorId?: string | null },
  ): Promise<SnapshotRestoreResult> {
    const { mode } = options;
    const actorId = options.actorId ?? null;
    const source = await this.ctx.repos.spaces.findById(spaceId);
    if (mode === 'replace' && !source) {
      throw ManabloxError.notFound('space.notFound', { spaceId });
    }
    await this.ctx.manablox.controls.assertFeature(source ? spaceId : null, 'snapshots');
    if (mode === 'new') await this.ctx.manablox.controls.assertFeature(null, 'spaceCreate');
    const { manifest, data, copy, ids, machineName } = await this.copyOf(spaceId, id, mode, source);

    const members = await this.members(source, actorId);
    const result = await this.ctx.spaces.importRestored(copy, members, {
      actorId,
      ...(mode === 'replace' && source
        ? { limitOffset: await this.ctx.transfer.limitsOf(source.id) }
        : {}),
    });
    const restoredId = result.spaceId;
    if (source) {
      await this.carrySecrets(source.id, restoredId, data, ids).catch((error: unknown) => {
        this.ctx.manablox.logger.warn(
          { err: error, spaceId: restoredId },
          'secrets not carried over',
        );
      });
    }

    let replacedDeleted = false;
    let finalName = machineName;
    if (mode === 'replace' && source) {
      ({ finalName, replacedDeleted } = await this.replace(
        source,
        restoredId,
        machineName,
        manifest,
      ));
    } else {
      await this.recordNew(restoredId, spaceId, id);
    }
    await this.ctx.options.afterRestore?.(restoredId);
    return {
      mode,
      snapshot: id,
      sourceSpaceId: spaceId,
      spaceId: restoredId,
      machineName: finalName,
      replacedDeleted,
      import: result,
    };
  }

  /** The snapshot's export with fresh ids and a free machine name, ready to import. */
  private async copyOf(
    spaceId: string,
    id: string,
    mode: SnapshotRestoreMode,
    source: SpaceRow | null,
  ): Promise<{
    manifest: SnapshotManifest;
    data: SpaceExport;
    copy: SpaceExport;
    ids: Map<string, string>;
    machineName: string;
  }> {
    const manifest = await this.ctx.manifest(spaceId, id);
    const data = JSON.parse(
      (await gunzipAsync(await this.ctx.requireStorage().get(fileKey(spaceId, id)))).toString(
        'utf8',
      ),
    ) as SpaceExport;

    const baseName = source?.machineName ?? manifest.machineName;
    const machineName =
      mode === 'replace'
        ? `${baseName}-restoring-${suffix()}`
        : await this.freeMachineName(`${baseName}-restored-${manifest.id.slice(0, 10)}`);
    const pluginIds = [
      ...transferProviders(this.ctx.manablox).flatMap(
        ({ kind, transfer }) => transfer.ids?.(data.plugins?.[kind] ?? []) ?? [],
      ),
      ...snapshotProviders(this.ctx.manablox).flatMap(({ kind, snapshot }) =>
        data.snapshots?.[kind] === undefined ? [] : (snapshot.ids?.(data.snapshots[kind]) ?? []),
      ),
    ];
    const { data: copy, ids } = remapExportIds(
      data,
      {
        machineName,
        ...(mode === 'new'
          ? { name: `${data.space.name} (restored ${manifest.createdAt.slice(0, 10)})` }
          : {}),
      },
      pluginIds,
    );
    return { manifest, data, copy, ids, machineName };
  }

  /**
   * The restored space takes the place of `source`, which is deleted; a failed take-over
   * deletes the restored space instead.
   */
  private async replace(
    source: SpaceRow,
    restoredId: string,
    machineName: string,
    manifest: SnapshotManifest,
  ): Promise<{ finalName: string; replacedDeleted: boolean }> {
    let finalName: string;
    try {
      finalName = await this.takeOver(source, restoredId, machineName, manifest);
    } catch (error) {
      await this.ctx.spaces.delete(restoredId).catch((failure: unknown) => {
        this.ctx.manablox.logger.error({ err: failure, spaceId: restoredId }, 'restore not undone');
      });
      throw error;
    }
    const replacedDeleted = await this.ctx.spaces.delete(source.id).then(
      () => true,
      (error: unknown) => {
        this.ctx.manablox.logger.error({ err: error, spaceId: source.id }, 'replaced space kept');
        return false;
      },
    );
    if (replacedDeleted) {
      await this.ctx.options.purgeOrphaned?.();
      await this.moveSnapshots(source.id, restoredId).catch((error: unknown) => {
        this.ctx.manablox.logger.warn({ err: error, spaceId: source.id }, 'snapshots not moved');
      });
    }
    return { finalName, replacedDeleted };
  }

  /** Audits and announces a restore as a new space. */
  private async recordNew(restoredId: string, spaceId: string, id: string): Promise<void> {
    const restored = await this.ctx.repos.spaces.findById(restoredId);
    await this.ctx.repos.transaction(async (tx) => {
      await this.ctx.audit
        .in(tx)
        .record('space.restore', { id: restoredId, name: restored?.name ?? null }, undefined, {
          snapshot: id,
          mode: 'new',
          sourceSpaceId: spaceId,
        });
      await this.restoredEvent(tx, restoredId, spaceId, id, 'new');
    });
  }

  /** Swaps identity from `old` to the restored space in one transaction; returns its machine name. */
  private async takeOver(
    old: SpaceRow,
    restoredId: string,
    temporary: string,
    manifest: SnapshotManifest,
  ): Promise<string> {
    const oldScope: ControlScope = { kind: 'space', id: old.id };
    const newScope: ControlScope = { kind: 'space', id: restoredId };
    await this.ctx.repos.transaction(async (tx) => {
      await tx.spaces.update(old.id, { machineName: `${old.machineName}-replaced-${suffix()}` });
      const restored = await tx.spaces.update(restoredId, { machineName: old.machineName });
      // API hosts apart, the rest of the sources as `hosts`.
      let hosts = 0;
      let apiHosts = 0;
      for (const source of hostSources(this.ctx.manablox)) {
        const moved = await source.moveSpace(tx, old.id, restoredId);
        if (source === API_HOST_SOURCE) apiHosts += moved;
        else hosts += moved;
      }
      if (old.groupId) {
        await tx.spaceGroups.assignSpaces(old.groupId, [restoredId]);
        await this.ctx.manablox.controls.emit(
          'space.groupChanged',
          newScope,
          { spaceId: restoredId, from: null, to: { id: old.groupId } },
          { tx },
        );
      }
      const values = Object.fromEntries(
        (await tx.controlSettings.listByScope(oldScope)).map((row) => [row.key, row.value]),
      );
      if (Object.keys(values).length > 0) await tx.controlSettings.upsertMany(newScope, values);
      await this.ctx.audit
        .in(tx)
        .record(
          'space.restore',
          restored,
          [{ path: 'machineName', from: temporary, to: old.machineName }],
          {
            snapshot: manifest.id,
            mode: 'replace',
            sourceSpaceId: old.id,
            hosts,
            apiHosts,
            groupId: old.groupId ?? null,
            controls: Object.keys(values),
          },
        );
      await this.restoredEvent(tx, restoredId, old.id, manifest.id, 'replace');
      tx.afterCommit(async () => {
        await this.ctx.options.controlStore?.invalidate([controlScopeTag(newScope)]);
        const tags = hostSources(this.ctx.manablox).map((source) => source.cacheTag);
        await purgeTags(this.ctx.manablox, restoredId, tags);
        await purgeTags(this.ctx.manablox, old.id, tags);
      });
    });
    return old.machineName;
  }

  private restoredEvent(
    tx: TransactionRepositories,
    spaceId: string,
    sourceSpaceId: string,
    snapshot: string,
    mode: SnapshotRestoreMode,
  ): Promise<void> {
    return this.ctx.manablox.controls.emit(
      'snapshot.restored',
      { kind: 'space', id: spaceId },
      { spaceId, sourceSpaceId, snapshot, mode },
      { tx },
    );
  }

  /**
   * Exports leave secrets out; a restore on the same instance takes the credential secrets
   * from the source's rows that still exist. Data providers carry theirs, and hear which
   * credentials came back (e.g. to switch on what needs them), through
   * `snapshot.afterCredentialsRestored`.
   */
  private async carrySecrets(
    sourceId: string,
    restoredId: string,
    data: SpaceExport,
    ids: Map<string, string>,
  ): Promise<void> {
    const credentials = await this.ctx.repos.credentials.listBySpace(sourceId);
    await this.ctx.repos.transaction(async (tx) => {
      const sealed = new Set<string>();
      for (const credential of credentials) {
        const target = ids.get(credential.id);
        if (!target || credential.data === null) continue;
        await tx.credentials.update(target, {
          data: credential.data,
          hint: credential.hint,
        });
        sealed.add(credential.id);
      }
      for (const { kind, hook } of credentialsRestoredHooks(this.ctx.manablox)) {
        await hook(
          {
            manablox: this.ctx.manablox,
            repos: tx,
            spaceId: restoredId,
            sourceSpaceId: sourceId,
            ids,
            entries: data.plugins?.[kind] ?? [],
            data: data.snapshots?.[kind],
          },
          sealed,
        );
      }
    });
  }

  /** The source's members, the actor as owner, or the superadmins when neither exists. */
  private async members(
    source: SpaceRow | null,
    actorId: string | null,
  ): Promise<Array<{ userId: string; role: SpaceRole }>> {
    const members = source
      ? (await this.ctx.repos.users.listMembersBySpace(source.id)).map((member) => ({
          userId: member.userId,
          role: member.role,
        }))
      : [];
    if (actorId && !members.some((member) => member.userId === actorId)) {
      const user = await this.ctx.repos.users.findById(actorId);
      if (user) members.push({ userId: actorId, role: 'owner' });
    }
    if (!members.some((member) => member.role === 'owner')) {
      for (const user of await this.ctx.repos.users.listByRole('superadmin')) {
        if (!members.some((member) => member.userId === user.id)) {
          members.push({ userId: user.id, role: 'owner' });
        }
      }
    }
    return members;
  }

  private async freeMachineName(base: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const name = attempt === 1 ? base : `${base}-${attempt}`;
      if (!(await this.ctx.repos.spaces.findByMachineName(name))) return name;
    }
  }

  /** Copies a replaced space's snapshots to the space that took its place. */
  private async moveSnapshots(fromSpaceId: string, toSpaceId: string): Promise<void> {
    const storage = this.ctx.storage;
    if (!storage?.list) return;
    for (const object of await storage.list(spacePrefix(fromSpaceId))) {
      const entry = parseManifestKey(object.key);
      if (!entry) continue;
      const manifest = await this.ctx.readManifest(fromSpaceId, entry.id).catch(() => null);
      if (!manifest) continue;
      await storage.put(
        fileKey(toSpaceId, entry.id),
        await storage.stream(fileKey(fromSpaceId, entry.id)),
        { contentType: 'application/gzip' },
      );
      await storage.put(
        manifestKey(toSpaceId, entry.id),
        Buffer.from(JSON.stringify({ ...manifest, spaceId: toSpaceId })),
        { contentType: 'application/json' },
      );
      await storage.delete(fileKey(fromSpaceId, entry.id));
      await storage.delete(manifestKey(fromSpaceId, entry.id));
    }
  }
}

const suffix = (): string => randomBytes(3).toString('hex');
