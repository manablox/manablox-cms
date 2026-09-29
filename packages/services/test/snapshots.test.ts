import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { definePlugin, ManabloxError } from '@manablox/core';
import type { ControlEventRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fileKey,
  manifestKey,
  SNAPSHOT_DUE_SLACK_MS,
  snapshotDate,
  snapshotDue,
  snapshotId,
} from '../src/snapshots/layout.js';
import { remapExportIds } from '../src/snapshots/remap.js';
import { SnapshotService } from '../src/snapshots/service.js';
import {
  createServiceContext,
  type ServiceContext,
  spaceGroup,
  withControls,
} from '../src/testing.js';
import type { SpaceExport } from '../src/transfer/format.js';
import { SpaceTransferService } from '../src/transfer/service.js';
import { memoryStorage } from './helpers/storage.js';
import { TEST_TYPES } from './helpers/types.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let ctx: ServiceContext;
let snapshots: SnapshotService;
const storage = memoryStorage();
/** The service's clock; `null` is the real time. */
let clock: Date | null = null;
let counter = 0;

/** What `snapshot.afterCredentialsRestored` heard: restored space, source space, sealed ids. */
const restoredCredentials: Array<{ spaceId: string; sourceSpaceId: string; sealed: string[] }> = [];
const probe = definePlugin({
  name: 'probe',
  data: [
    {
      kind: 'probe.vault',
      snapshot: {
        async afterCredentialsRestored(context, sealed) {
          restoredCredentials.push({
            spaceId: context.spaceId,
            sourceSpaceId: context.sourceSpaceId,
            sealed: [...sealed],
          });
        },
      },
    },
  ],
});

beforeAll(async () => {
  ctx = await createServiceContext('snapshots', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    storage,
    config: { plugins: [probe] },
  });
  snapshots = new SnapshotService(
    ctx.manablox,
    ctx.repos,
    ctx.spaces,
    new SpaceTransferService(ctx.manablox, ctx.repos, storage),
    storage,
    { controlStore: ctx.controlStore, now: () => clock ?? new Date() },
  );
});
afterAll(async () => {
  await ctx?.close();
});

const name = () => `snap-${++counter}-${randomUUID().slice(0, 6)}`;

/** A space with one document using one asset whose bytes are in storage. */
async function freshSpace(ownerId: string | null = null) {
  const machineName = name();
  const space = await ctx.spaces.create(
    { name: machineName, machineName, url: 'http://snap.test' },
    ownerId,
  );
  const key = `${space.id}/2026/09/${machineName}.jpg`;
  await storage.put(key, Buffer.from('bytes'), { contentType: 'image/jpeg' });
  const asset = await ctx.repos.assets.create({
    spaceId: space.id,
    driver: 'local',
    key,
    filename: 'hero.jpg',
    name: 'Hero',
    mimeType: 'image/jpeg',
    size: 5,
  });
  const document = await ctx.content.create({
    spaceId: space.id,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: 'Home',
    slug: 'home',
    fields: { hero: asset.id },
  });
  return { space, asset, document, key };
}

const freshUser = () =>
  ctx.repos.users.create({
    name: 'U',
    email: `${name()}@example.test`,
    role: 'editor',
    passwordHash: 'x',
  });

/** Switches snapshots on for the space with an interval; returns the restore. */
const enable = (spaceId: string, values: Record<string, unknown> = {}) =>
  withControls(ctx, {
    scope: { kind: 'space', id: spaceId },
    features: { snapshots: true },
    values,
  });

const eventsSince = async (mark: number, type: string): Promise<ControlEventRow[]> => {
  const until = Date.now() + 5000;
  for (;;) {
    const rows = (await ctx.repos.controlEvents.listAfter(mark, 1000)).filter(
      (row) => row.type === type,
    );
    if (rows.length > 0 || Date.now() > until) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const titles = async (spaceId: string) =>
  (await ctx.repos.content.page({ spaceId }, { limit: 100, offset: 0 })).items
    .map((row) => row.title)
    .sort();

describe('snapshot layout', () => {
  it('turns a date into a key-safe id and back', () => {
    const at = new Date('2026-09-25T10:15:30.123Z');
    expect(snapshotId(at)).toBe('2026-09-25T10-15-30-123Z');
    expect(snapshotDate(snapshotId(at)).toISOString()).toBe(at.toISOString());
  });

  it('decides when a scheduled snapshot is due', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(snapshotDue('daily', false, null, now)).toBe(false);
    expect(snapshotDue(null, true, null, now)).toBe(false);
    expect(snapshotDue('hourly', true, null, now)).toBe(true);
    expect(snapshotDue('hourly', true, ago(HOUR), now)).toBe(true);
    expect(snapshotDue('hourly', true, ago(HOUR - SNAPSHOT_DUE_SLACK_MS), now)).toBe(true);
    expect(snapshotDue('hourly', true, ago(30 * 60_000), now)).toBe(false);
    expect(snapshotDue('daily', true, ago(23 * HOUR), now)).toBe(false);
    expect(snapshotDue('daily', true, ago(DAY), now)).toBe(true);
  });

  it('remaps the ids a space owns and keeps asset keys and foreign ids', () => {
    const spaceId = randomUUID();
    const contentId = randomUUID();
    const assetId = randomUUID();
    const userId = randomUUID();
    const data = {
      manabloxSpaceExport: 1,
      exportedAt: '',
      sections: ['contents', 'assets'],
      space: {
        id: spaceId,
        name: 'S',
        machineName: 's',
        description: null,
        url: 'http://x',
        defaultLocale: 'en',
        locales: ['en'],
        settings: { homeContentId: contentId },
      },
      contents: [
        {
          id: contentId,
          localizationId: contentId,
          fields: { hero: assetId, author: userId },
        },
      ],
      assets: [{ id: assetId, driver: 'local', key: `${spaceId}/a.jpg` }],
    } as unknown as SpaceExport;

    const { data: copy, ids } = remapExportIds(data, { machineName: 's2' });
    const newContent = ids.get(contentId) as string;
    expect(copy.space.id).toBe(ids.get(spaceId));
    expect(copy.space.machineName).toBe('s2');
    expect(copy.space.settings.homeContentId).toBe(newContent);
    expect(copy.contents?.[0]).toMatchObject({
      id: newContent,
      localizationId: newContent,
      fields: { hero: assetId, author: userId },
    });
    expect(copy.assets?.[0]).toMatchObject({ id: assetId, key: `${spaceId}/a.jpg` });
  });
});

describe('taking snapshots', () => {
  it('writes the export without asset bytes and a manifest beside it', async () => {
    const { space, asset } = await freshSpace();
    const restore = await enable(space.id);
    const mark = await ctx.repos.controlEvents.latestSeq();
    const before = new Set(storage.objects.keys());
    try {
      const manifest = await snapshots.create(space.id);

      expect(manifest).toMatchObject({
        spaceId: space.id,
        machineName: space.machineName,
        trigger: 'manual',
        formatVersion: 1,
        counts: { contents: 1, assets: 1 },
      });
      const added = [...storage.objects.keys()].filter((key) => !before.has(key)).sort();
      expect(added).toEqual([fileKey(space.id, manifest.id), manifestKey(space.id, manifest.id)]);
      const file = storage.objects.get(fileKey(space.id, manifest.id)) as Buffer;
      expect(manifest.size).toBe(file.byteLength);
      const payload = JSON.parse(gunzipSync(file).toString('utf8')) as SpaceExport;
      expect(payload.assets).toEqual([expect.objectContaining({ id: asset.id, key: asset.key })]);
      expect(payload.contents?.map((row) => row.title)).toEqual(['Home']);

      const [event] = await eventsSince(mark, 'snapshot.completed');
      expect(event?.payload).toMatchObject({ spaceId: space.id, snapshot: manifest.id });
      const audit = await ctx.repos.audit.page({ spaceId: space.id, actions: ['space.snapshot'] });
      expect(audit.total).toBe(1);
    } finally {
      await restore();
    }
  });

  it('is refused while the feature is off', async () => {
    const { space } = await freshSpace();
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: space.id },
      features: { snapshots: false },
    });
    try {
      await expect(snapshots.create(space.id)).rejects.toMatchObject({ key: 'control.feature' });
    } finally {
      await restore();
    }
  });

  it('reports a failure and leaves no file behind', async () => {
    const { space } = await freshSpace();
    const mark = await ctx.repos.controlEvents.latestSeq();
    const put = storage.put;
    storage.put = async (key, body, options) => {
      if (key.endsWith('.manifest.json')) throw new Error('disk full');
      return put(key, body, options);
    };
    try {
      await expect(snapshots.create(space.id)).rejects.toThrow('disk full');
    } finally {
      storage.put = put;
    }
    expect(await storage.list(`snapshots/${space.id}/`)).toEqual([]);
    const [event] = await eventsSince(mark, 'snapshot.failed');
    expect(event?.payload).toMatchObject({ spaceId: space.id, trigger: 'manual' });
  });

  it('lists snapshots newest first', async () => {
    const { space } = await freshSpace();
    clock = new Date('2026-09-20T10:00:00Z');
    const first = await snapshots.create(space.id);
    clock = new Date('2026-09-21T10:00:00Z');
    const second = await snapshots.create(space.id);
    clock = null;
    expect((await snapshots.list(space.id)).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});

describe('the schedule', () => {
  it('takes snapshots of due spaces only, then waits for the interval', async () => {
    const daily = (await freshSpace()).space;
    const unset = (await freshSpace()).space;
    const off = (await freshSpace()).space;
    const restores = [
      await enable(daily.id, { 'snapshots.interval': 'daily' }),
      await enable(unset.id),
      await withControls(ctx, {
        scope: { kind: 'space', id: off.id },
        features: { snapshots: false },
        values: { 'snapshots.interval': 'hourly' },
      }),
    ];
    try {
      const start = new Date(Date.now() + 1000 * DAY);
      clock = start;
      const due = await snapshots.due(start);
      expect(due).toContain(daily.id);
      expect(due).not.toContain(unset.id);
      expect(due).not.toContain(off.id);

      await snapshots.tick(start);
      const [taken] = await snapshots.list(daily.id);
      expect(taken?.trigger).toBe('scheduled');
      expect(await snapshots.due(new Date(start.getTime() + 12 * HOUR))).not.toContain(daily.id);
      expect(await snapshots.due(new Date(start.getTime() + DAY))).toContain(daily.id);
    } finally {
      clock = null;
      for (const restore of restores) await restore();
    }
  });

  it('prunes snapshots older than the retention window', async () => {
    const { space } = await freshSpace();
    const restore = await enable(space.id, { 'retention.snapshotsDays': 7 });
    try {
      const now = new Date('2026-09-25T12:00:00Z');
      clock = new Date(now.getTime() - 8 * DAY);
      const old = await snapshots.create(space.id);
      clock = new Date(now.getTime() - 2 * DAY);
      const recent = await snapshots.create(space.id);
      clock = null;

      await snapshots.prune(now);
      expect((await snapshots.list(space.id)).map((entry) => entry.id)).toEqual([recent.id]);
      expect(storage.objects.has(fileKey(space.id, old.id))).toBe(false);
    } finally {
      clock = null;
      await restore();
    }
  });

  it('keeps every snapshot without a window', async () => {
    const { space } = await freshSpace();
    const restore = await enable(space.id, { 'retention.snapshotsDays': null });
    try {
      clock = new Date(Date.now() - 400 * DAY);
      await snapshots.create(space.id);
      clock = null;
      await snapshots.prune(new Date());
      expect(await snapshots.list(space.id)).toHaveLength(1);
    } finally {
      clock = null;
      await restore();
    }
  });
});

describe('deleted asset files', () => {
  it('are deleted at once while snapshots are not in use', async () => {
    const { space, asset } = await freshSpace();
    expect(await snapshots.retainDeleted({ id: asset.id, keys: [asset.key] }, [space.id])).toBe(
      false,
    );
  });

  it('are kept with a tombstone, then purged after the longest retention', async () => {
    const { space, asset, key } = await freshSpace();
    const restore = await enable(space.id, { 'snapshots.interval': 'daily' });
    try {
      const deletedAt = new Date('2026-01-10T08:00:00Z');
      clock = deletedAt;
      expect(await snapshots.retainDeleted({ id: asset.id, keys: [key] }, [space.id])).toBe(true);
      clock = null;
      await ctx.repos.assets.delete(asset.id);
      const tombstone = `trash/2026-01-10/${asset.id}.json`;
      expect(storage.objects.has(tombstone)).toBe(true);

      // Within the default week the bytes stay.
      await snapshots.purgeTrash(new Date(deletedAt.getTime() + 3 * DAY));
      expect(storage.objects.has(key)).toBe(true);

      await snapshots.purgeTrash(new Date(deletedAt.getTime() + 8 * DAY));
      expect(storage.objects.has(key)).toBe(false);
      expect(storage.objects.has(tombstone)).toBe(false);
    } finally {
      clock = null;
      await restore();
    }
  });

  it('are kept for good when an asset came back through a restore', async () => {
    const { space, asset, key } = await freshSpace();
    const restore = await enable(space.id, { 'snapshots.interval': 'hourly' });
    try {
      const deletedAt = new Date('2026-02-10T08:00:00Z');
      clock = deletedAt;
      await snapshots.retainDeleted({ id: asset.id, keys: [key] }, [space.id]);
      clock = null;
      // The row stays, as a restore recreates it.
      await snapshots.purgeTrash(new Date(deletedAt.getTime() + 30 * DAY));
      expect(storage.objects.has(key)).toBe(true);
      expect(storage.objects.has(`trash/2026-02-10/${asset.id}.json`)).toBe(false);
    } finally {
      clock = null;
      await restore();
    }
  });
});

describe('restoring', () => {
  it('restores into a new space beside the original', async () => {
    const owner = await freshUser();
    const { space, asset, key } = await freshSpace(owner.id);
    const memo = await ctx.contentTypes.create({
      name: 'memo',
      spaceId: space.id,
      fields: [{ name: 'note', type: 'string' }],
    });
    await ctx.content.create({
      spaceId: space.id,
      typeId: memo.id as string,
      locale: 'en',
      title: 'Memo',
      slug: 'memo',
      fields: { note: 'kept' },
    });
    const restore = await enable(space.id);
    try {
      const manifest = await snapshots.create(space.id);
      await ctx.content.create({
        spaceId: space.id,
        typeId: ctx.ids.article as string,
        locale: 'en',
        title: 'Later',
        slug: 'later',
        fields: {},
      });
      const mark = await ctx.repos.controlEvents.latestSeq();

      const result = await snapshots.restore(space.id, manifest.id, {
        mode: 'new',
        actorId: owner.id,
      });

      expect(result.spaceId).not.toBe(space.id);
      expect(result.machineName).toMatch(new RegExp(`^${space.machineName}-restored-`));
      expect(await ctx.repos.environments.listBySpace(result.spaceId)).toMatchObject([
        { machineName: 'production', kind: 'production' },
      ]);
      expect(await titles(result.spaceId)).toEqual(['Home', 'Memo']);
      expect(await titles(space.id)).toEqual(['Home', 'Later', 'Memo']);
      // The runtime type is copied under a new id; the original keeps its own.
      const types = (await ctx.repos.contentTypes.list()).filter((type) => type.name === 'memo');
      const copied = types.find((type) => type.spaceId === result.spaceId);
      expect(copied?.id).not.toBe(memo.id);
      const [restoredMemo] = (
        await ctx.repos.content.page(
          { spaceId: result.spaceId, typeIds: [copied?.id as string] },
          { limit: 5, offset: 0 },
        )
      ).items;
      expect(restoredMemo?.fields).toMatchObject({ note: 'kept' });
      const restoredAsset = await ctx.repos.assets.findById(asset.id, result.spaceId);
      expect(restoredAsset?.key).toBe(key);
      expect(await ctx.repos.users.findSpaceRole(owner.id, result.spaceId)).toBe('owner');
      const [event] = await eventsSince(mark, 'snapshot.restored');
      expect(event?.payload).toMatchObject({
        spaceId: result.spaceId,
        sourceSpaceId: space.id,
        mode: 'new',
      });
    } finally {
      await restore();
    }
  });

  it('replaces a space: identity, hosts, group, members and controls move over', async () => {
    const owner = await freshUser();
    const editor = await freshUser();
    const { space, asset, key } = await freshSpace(owner.id);
    await ctx.spaces.grant(space.id, editor.id, 'editor');
    const group = await spaceGroup(ctx, [space.id], name());
    const hostname = `${name()}.example.test`;
    await ctx.repos.spaceApiHosts.create(space.id, { hostname });
    const restore = await enable(space.id, { 'snapshots.interval': 'daily' });
    try {
      const manifest = await snapshots.create(space.id);
      // After the snapshot: a new document, and the asset deleted with its bytes kept.
      await ctx.content.create({
        spaceId: space.id,
        typeId: ctx.ids.article as string,
        locale: 'en',
        title: 'Later',
        slug: 'later',
        fields: {},
      });
      expect(await snapshots.retainDeleted({ id: asset.id, keys: [key] }, [space.id])).toBe(true);
      await ctx.repos.assets.delete(asset.id);

      const result = await snapshots.restore(space.id, manifest.id, {
        mode: 'replace',
        actorId: owner.id,
      });

      expect(result.replacedDeleted).toBe(true);
      expect(await ctx.repos.spaces.findById(space.id)).toBeNull();
      const replaced = await ctx.repos.spaces.findById(result.spaceId);
      expect(replaced?.machineName).toBe(space.machineName);
      expect(replaced?.groupId).toBe(group.id);
      expect(await titles(result.spaceId)).toEqual(['Home']);
      const production = await ctx.repos.environments.production(result.spaceId);
      expect(await ctx.repos.spaceApiHosts.findByHostname(hostname)).toMatchObject({
        spaceId: result.spaceId,
        environmentId: production?.id,
      });
      expect(await ctx.repos.users.findSpaceRole(owner.id, result.spaceId)).toBe('owner');
      expect(await ctx.repos.users.findSpaceRole(editor.id, result.spaceId)).toBe('editor');
      const controls = await ctx.controls.settings({ kind: 'space', id: result.spaceId });
      expect(controls['snapshots.interval']).toBe('daily');
      // The deleted asset is back, on its kept bytes.
      expect((await ctx.repos.assets.findById(asset.id, result.spaceId))?.key).toBe(key);
      expect(storage.objects.has(key)).toBe(true);
      // Snapshots follow the space.
      expect((await snapshots.list(result.spaceId)).map((entry) => entry.id)).toEqual([
        manifest.id,
      ]);
      expect(await storage.list(`snapshots/${space.id}/`)).toEqual([]);
      const audit = await ctx.repos.audit.page({
        spaceId: result.spaceId,
        actions: ['space.restore'],
      });
      expect(audit.total).toBe(1);
    } finally {
      // The space is gone with its values.
      await restore().catch(() => {});
    }
  });

  it('counts a replace as net zero against the spaces limit', async () => {
    const { space } = await freshSpace();
    const restoreSpace = await enable(space.id);
    const manifest = await snapshots.create(space.id);
    const total = (await ctx.repos.spaces.list()).length;
    const restoreLimit = await withControls(ctx, {
      values: { 'limits.spaces': { max: total, mode: 'hard' } },
    });
    try {
      const error = await snapshots
        .restore(space.id, manifest.id, { mode: 'new' })
        .catch((failure: unknown) => failure);
      expect(ManabloxError.is(error) && error.key).toBe('control.limit');

      const result = await snapshots.restore(space.id, manifest.id, { mode: 'replace' });
      expect(result.replacedDeleted).toBe(true);
      expect((await ctx.repos.spaces.list()).length).toBe(total);
    } finally {
      await restoreLimit();
      await restoreSpace().catch(() => {});
    }
  });

  it('carries credential secrets over from the space it restores', async () => {
    const { space } = await freshSpace();
    const credential = await ctx.repos.credentials.create({
      spaceId: space.id,
      name: 'Mailer',
      slug: 'mailer',
      kind: 'bearer',
      data: 'sealed',
      hint: 'abcd',
    });
    const restore = await enable(space.id);
    try {
      const manifest = await snapshots.create(space.id);
      const result = await snapshots.restore(space.id, manifest.id, { mode: 'new' });
      const [copy] = await ctx.repos.credentials.listBySpace(result.spaceId);
      expect(copy?.id).not.toBe(credential.id);
      expect(copy).toMatchObject({ slug: 'mailer', data: 'sealed', hint: 'abcd' });
      expect(restoredCredentials.at(-1)).toEqual({
        spaceId: result.spaceId,
        sourceSpaceId: space.id,
        sealed: [credential.id],
      });
    } finally {
      await restore();
    }
  });

  it('refuses an unknown snapshot', async () => {
    const { space } = await freshSpace();
    await expect(
      snapshots.restore(space.id, '2020-01-01T00-00-00-000Z', { mode: 'new' }),
    ).rejects.toMatchObject({ key: 'snapshot.notFound' });
  });
});
