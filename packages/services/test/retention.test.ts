import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuditExportStorage, pruneRetention } from '../src/retention.js';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('retention', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const DAY = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const freshSpace = async () => {
  const machineName = `ret-${randomUUID().slice(0, 8)}`;
  return (await ctx.spaces.create({ name: machineName, machineName, url: 'http://r.test' }, null))
    .id;
};

/** Controls at several scopes, restored in reverse. */
async function withScopes(
  entries: Array<[{ kind: 'instance' } | { kind: 'space'; id: string }, Record<string, unknown>]>,
): Promise<() => Promise<void>> {
  const restores: Array<() => Promise<void>> = [];
  for (const [scope, values] of entries) restores.push(await withControls(ctx, { scope, values }));
  return async () => {
    for (const restore of restores.reverse()) await restore();
  };
}

describe('retention settings', () => {
  it('stores a null window and resolves it as keep', async () => {
    const spaceId = await freshSpace();
    const scope = { kind: 'space' as const, id: spaceId };
    const restore = await withScopes([
      [{ kind: 'instance' }, { 'retention.versionsDays': 30 }],
      [scope, { 'retention.versionsDays': null }],
    ]);
    try {
      expect(await ctx.controls.settings(scope)).toEqual({ 'retention.versionsDays': null });
      expect((await ctx.manablox.controls.resolved(spaceId)).retention.versionsDays).toBeNull();
      expect((await ctx.manablox.controls.resolved(null)).retention.versionsDays).toBe(30);
    } finally {
      await restore();
    }
  });

  it('does nothing without a retention setting', async () => {
    ctx.resetQueryCount();
    expect(await pruneRetention(ctx.manablox, ctx.repos)).toEqual({});
    expect(ctx.queryCount()).toBe(1);
  });
});

describe('content versions', () => {
  it('hides versions past the window at once and prunes them in the job', async () => {
    const spaceId = await freshSpace();
    const input = (title: string) => ({
      spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title,
      slug: 'doc',
      fields: {},
    });
    const row = await ctx.content.create(input('One'));
    await ctx.content.update(spaceId, row.id, input('Two'));
    await ctx.content.update(spaceId, row.id, input('Three'));
    await ctx.repos.content.restoreHistory(row.id, {
      version: 3,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      versions: [1, 2, 3].map((version) => ({
        version,
        label: null,
        snapshot: {},
        createdAt: daysAgo(20),
        createdBy: null,
      })),
    });
    const versions = async () =>
      (await ctx.content.versions(spaceId, row.id)).items.map((item) => item.version);
    expect(await versions()).toEqual([3, 2, 1]);

    const restore = await withScopes([
      [{ kind: 'space', id: spaceId }, { 'retention.versionsDays': 10 }],
    ]);
    try {
      expect(await versions()).toEqual([3]);
      const report = await pruneRetention(ctx.manablox, ctx.repos);
      expect(report.versionsDays).toBe(2);
    } finally {
      await restore();
    }
    expect(await versions()).toEqual([3]);
  });
});

describe('audit log', () => {
  const actor = { kind: 'system' as const, id: null, label: 'test' };
  const append = (spaceId: string | null, age: number, label: string) =>
    ctx.repos.audit.append({
      actor,
      spaceId,
      action: 'content.update',
      targetKind: 'content',
      targetId: label,
      targetLabel: label,
      at: daysAgo(age),
    });

  it('filters every read by the window of the entry’s scope', async () => {
    const spaceId = await freshSpace();
    const kept = await freshSpace();
    const old = await append(spaceId, 40, 'r-space-old');
    await append(spaceId, 5, 'r-space-new');
    await append(kept, 40, 'r-kept-old');
    await append(null, 40, 'r-instance-old');
    const restore = await withScopes([
      [{ kind: 'instance' }, { 'retention.auditDays': 30 }],
      [{ kind: 'space', id: kept }, { 'retention.auditDays': null }],
    ]);
    try {
      const labels = async (read: Promise<{ items: Array<{ targetLabel: string | null }> }>) =>
        (await read).items.map((item) => item.targetLabel).sort();
      const filter = { search: 'r-' };
      expect(await labels(ctx.audit.list(spaceId, filter))).toEqual(['r-space-new']);
      expect(await labels(ctx.audit.list(kept, filter))).toEqual(['r-kept-old']);
      expect(await labels(ctx.audit.listInstance(filter))).toEqual(['r-kept-old', 'r-space-new']);
      expect(await labels(ctx.audit.listInstance({ ...filter, spaceId: null }))).toEqual([]);
      expect(await labels(ctx.audit.forTarget(spaceId, 'content', 'r-space-old'))).toEqual([]);
      await expect(ctx.audit.get(spaceId, old.id)).rejects.toMatchObject({ key: 'audit.notFound' });
      await expect(ctx.audit.get(null, old.id)).rejects.toMatchObject({ key: 'audit.notFound' });
    } finally {
      await restore();
    }
    expect((await ctx.audit.get(spaceId, old.id)).id).toBe(old.id);
  });

  it('exports before pruning and prunes nothing when the export fails', async () => {
    const spaceId = await freshSpace();
    await append(spaceId, 50, 'e-old-1');
    await append(spaceId, 45, 'e-old-2');
    await append(spaceId, 1, 'e-new');
    const puts: Array<{ key: string; body: Buffer; contentType: string }> = [];
    const storage: AuditExportStorage = {
      put: async (key, body, options) => {
        puts.push({ key, body, contentType: options.contentType });
      },
    };
    const failing: AuditExportStorage = {
      put: async () => {
        throw new Error('bucket unavailable');
      },
    };
    const restore = await withScopes([
      [{ kind: 'instance' }, { 'retention.auditExport': true }],
      [{ kind: 'space', id: spaceId }, { 'retention.auditDays': 30 }],
    ]);
    const count = () => ctx.repos.audit.count({ spaceId, search: 'e-' });
    try {
      await expect(pruneRetention(ctx.manablox, ctx.repos, { storage: failing })).rejects.toThrow(
        'bucket unavailable',
      );
      expect(await count()).toBe(3);

      const report = await pruneRetention(ctx.manablox, ctx.repos, { storage, batch: 1 });
      expect(report.auditDays).toBe(2);
      expect(await count()).toBe(1);
      expect(puts).toHaveLength(2);
      expect(puts[0]?.key).toMatch(
        new RegExp(
          `^audit-exports/${spaceId}/\\d{4}-\\d\\d-\\d\\dT\\d{6}\\.\\d{3}Z-.+\\.ndjson\\.gz$`,
        ),
      );
      expect(puts[0]?.contentType).toBe('application/gzip');
      const lines = gunzipSync(puts[0]?.body as Buffer)
        .toString()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { targetLabel: string; hash: string });
      expect(lines.map((line) => line.targetLabel)).toEqual(['e-old-1']);
      expect(await ctx.repos.audit.verify()).toMatchObject({ ok: true, brokenAt: null });
      const anchors = await ctx.repos.audit.page({ spaceId, actions: ['audit.pruned'] });
      expect(anchors.total).toBe(2);
    } finally {
      await restore();
    }
  });

  it('refuses to prune with export on but no storage', async () => {
    const restore = await withScopes([
      [{ kind: 'instance' }, { 'retention.auditExport': true, 'retention.auditDays': 3650 }],
    ]);
    try {
      await expect(pruneRetention(ctx.manablox, ctx.repos)).rejects.toThrow(/storage/);
    } finally {
      await restore();
    }
  });
});
