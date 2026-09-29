import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEntryRow } from '../src/schema/index.js';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('retention');
  otherSpaceId = (
    await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'http://o.test' })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * DAY);
const refused = {
  cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }),
};

describe('control values', () => {
  it('stores a JSON null and reads it back as null', async () => {
    const { controlSettings } = ctx.repos;
    const scope = { kind: 'space' as const, id: ctx.spaceId };
    await controlSettings.upsert(scope, 'retention.versionsDays', null);
    expect((await controlSettings.find(scope, 'retention.versionsDays'))?.value).toBeNull();
    await controlSettings.upsertMany(scope, { 'retention.versionsDays': 30 });
    await controlSettings.replaceScope(scope, { 'retention.versionsDays': null });
    const rows = await controlSettings.listByKeys(['retention.versionsDays']);
    expect(rows.map((row) => [row.scopeKind, row.value])).toEqual([['space', null]]);
    await controlSettings.deleteScope(scope);
  });
});

describe('content versions', () => {
  async function withVersions(slug: string, ages: number[]) {
    const node = await makeNode(ctx, { title: slug, slug });
    const { contentVersions: table } = ctx.handle.tables;
    await ctx.handle.db.delete(table).where(eq(table.contentId, node.id));
    await ctx.handle.db.insert(table).values(
      ages.map((age, index) => ({
        contentId: node.id,
        version: index + 1,
        snapshot: {},
        createdAt: daysAgo(age),
      })),
    );
    return node;
  }

  const versionsOf = async (contentId: string) => {
    const { contentVersions: table } = ctx.handle.tables;
    const rows = await ctx.handle.db
      .select({ version: table.version })
      .from(table)
      .where(eq(table.contentId, contentId));
    return rows.map((row) => row.version).sort((a, b) => a - b);
  };

  it('prunes old versions but keeps the newest, the published and an approval’s', async () => {
    const kept = await withVersions('kept', [50, 40, 30, 20, 10]);
    // Version 2 is published, version 3 waits for approval, version 4 had one decided.
    await ctx.repos.content.publish(kept.id);
    const { publishedContents: published } = ctx.handle.tables;
    await ctx.handle.db
      .update(published)
      .set({ sourceVersion: 2 })
      .where(eq(published.id, kept.id));
    await ctx.repos.approvals.request({
      spaceId: ctx.spaceId,
      contentId: kept.id,
      typeId: kept.typeId,
      requestedBy: null,
      requestedByLabel: 'x',
      contentVersion: 3,
    });
    const decided = await ctx.repos.approvals.request({
      spaceId: ctx.spaceId,
      contentId: kept.id,
      typeId: kept.typeId,
      requestedBy: null,
      requestedByLabel: 'x',
      contentVersion: 4,
    });
    await ctx.repos.approvals.decide(decided.id, {
      status: 'rejected',
      decidedBy: null,
      decidedByLabel: null,
    });
    // An old single version stays as the newest; a document of the other space is not touched.
    const single = await withVersions('single', [90]);

    const listed = await ctx.repos.content.pageVersions(kept.id, undefined, daysAgo(15));
    expect(listed.items.map((item) => item.version)).toEqual([5, 3, 2]);

    expect(await ctx.repos.content.pruneVersions(ctx.spaceId, daysAgo(15), 100)).toBe(2);
    expect(await versionsOf(kept.id)).toEqual([2, 3, 5]);
    expect(await versionsOf(single.id)).toEqual([1]);
    expect(await ctx.repos.content.pruneVersions(otherSpaceId, daysAgo(0), 100)).toBe(0);
  });

  it('deletes in batches, oldest first', async () => {
    const node = await withVersions('batched', [9, 8, 7, 6, 5, 1]);
    expect(await ctx.repos.content.pruneVersions(ctx.spaceId, daysAgo(2), 2)).toBe(2);
    expect(await versionsOf(node.id)).toEqual([3, 4, 5, 6]);
    expect(await ctx.repos.content.pruneVersions(ctx.spaceId, daysAgo(2), 2)).toBe(2);
    expect(await ctx.repos.content.pruneVersions(ctx.spaceId, daysAgo(2), 2)).toBe(1);
    expect(await ctx.repos.content.pruneVersions(ctx.spaceId, daysAgo(2), 2)).toBe(0);
    expect(await versionsOf(node.id)).toEqual([6]);
  });
});

describe('age cutoffs', () => {
  it('prunes notifications instance-wide by age', async () => {
    const user = await ctx.repos.users.create({
      name: 'Reader',
      email: `reader-${now}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });
    const rows = await ctx.repos.notifications.createMany(
      [ctx.spaceId, otherSpaceId, null].map((spaceId) => ({
        userId: user.id,
        spaceId,
        kind: 'content.approved' as const,
        title: 'Note',
      })),
    );
    const { notifications } = ctx.handle.tables;
    await ctx.handle.db
      .update(notifications)
      .set({ createdAt: daysAgo(40) })
      .where(
        inArray(
          notifications.id,
          rows.slice(0, 2).map((row) => row.id),
        ),
      );
    expect(await ctx.repos.notifications.pruneBefore(daysAgo(30), 1)).toBe(1);
    expect(await ctx.repos.notifications.pruneBefore(daysAgo(30), 1)).toBe(1);
    expect(await ctx.repos.notifications.pruneBefore(daysAgo(30), 1)).toBe(0);
    expect(await ctx.repos.notifications.countUnread(user.id)).toBe(1);
  });
});

describe('audit retention', () => {
  const actor = { kind: 'system' as const, id: null, label: 'test' };
  const entry = (spaceId: string | null, age: number, label: string) => ({
    actor,
    spaceId,
    action: 'content.update' as const,
    targetKind: 'content' as const,
    targetId: label,
    targetLabel: label,
    at: daysAgo(age),
  });
  const labels = (rows: AuditEntryRow[]) => rows.map((row) => row.targetLabel).sort();

  it('filters reads by the window of each scope', async () => {
    const third = (
      await ctx.repos.spaces.create({ name: 'Third', machineName: 'third', url: 'http://t.test' })
    ).id;
    await ctx.repos.audit.appendMany([
      entry(null, 40, 'f-instance-old'),
      entry(null, 5, 'f-instance-new'),
      entry(ctx.spaceId, 40, 'f-space-old'),
      entry(ctx.spaceId, 15, 'f-space-mid'),
      entry(third, 40, 'f-third-old'),
      entry(third, 15, 'f-third-mid'),
    ]);
    const search = 'f-';
    // Instance and unlisted spaces keep 30 days, the test space 10, the third everything.
    const retention = {
      instance: daysAgo(30),
      spaces: new Map([
        [ctx.spaceId, daysAgo(10)],
        [third, null],
      ]),
    };
    const all = await ctx.repos.audit.page({ search, retention }, undefined, {
      limit: 50,
      offset: 0,
    });
    expect(labels(all.items)).toEqual(['f-instance-new', 'f-third-mid', 'f-third-old']);
    const space = await ctx.repos.audit.page({
      search,
      spaceId: ctx.spaceId,
      retention: { instance: daysAgo(20) },
    });
    expect(labels(space.items)).toEqual(['f-space-mid']);
    expect(await ctx.repos.audit.count({ search, retention: { instance: null } })).toBe(6);
    const target = await ctx.repos.audit.pageByTarget(
      { kind: 'content', id: 'f-third-old', spaceId: third },
      undefined,
      { instance: daysAgo(30) },
    );
    expect(target.total).toBe(0);
  });

  it('prunes a scope behind an anchor and the chain still verifies', async () => {
    // Interleaved scopes, so the pruned rows leave several gaps.
    await ctx.repos.audit.appendMany([
      entry(ctx.spaceId, 50, 'p-space-1'),
      entry(otherSpaceId, 50, 'p-other-1'),
      entry(ctx.spaceId, 45, 'p-space-2'),
      entry(ctx.spaceId, 44, 'p-space-3'),
      entry(otherSpaceId, 40, 'p-other-2'),
      entry(ctx.spaceId, 35, 'p-space-4'),
      entry(ctx.spaceId, 1, 'p-space-5'),
    ]);
    const first = await ctx.repos.audit.prune({
      spaceId: ctx.spaceId,
      before: daysAgo(30),
      limit: 3,
    });
    expect(first?.count).toBe(3);
    expect(first?.anchor).toMatchObject({
      action: 'audit.pruned',
      targetKind: 'audit',
      spaceId: ctx.spaceId,
    });
    expect(first?.anchor.meta).toMatchObject({ count: 3, bridges: expect.any(Array) });
    expect(await ctx.repos.audit.verify(2)).toMatchObject({ ok: true, brokenAt: null });

    // The rest, older entries of other test cases included.
    for (;;) {
      const next = await ctx.repos.audit.prune({
        spaceId: ctx.spaceId,
        before: daysAgo(30),
        limit: 3,
      });
      if (!next) break;
    }
    const left = await ctx.repos.audit.page({ search: 'p-' });
    expect(labels(left.items)).toEqual(['p-other-1', 'p-other-2', 'p-space-5']);
    expect(await ctx.repos.audit.verify(3)).toMatchObject({ ok: true, brokenAt: null });

    // Instance entries next, and the newest entry of the chain among them.
    await ctx.repos.audit.append(entry(null, 60, 'p-instance-last'));
    expect(
      (await ctx.repos.audit.prune({ spaceId: null, before: daysAgo(30), limit: 100 }))?.count,
    ).toBeGreaterThan(0);
    expect(await ctx.repos.audit.verify()).toMatchObject({ ok: true, brokenAt: null });
    // Anchors are never pruned.
    const everything = { spaceId: null, before: new Date(now + DAY), limit: 100 };
    expect(await ctx.repos.audit.prune(everything)).not.toBeNull();
    expect(await ctx.repos.audit.prune(everything)).toBeNull();
    expect(await ctx.repos.audit.count({ actions: ['audit.pruned'] })).toBeGreaterThan(0);
    expect(await ctx.repos.audit.verify()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('still refuses direct deletes, before and after a prune', async () => {
    const { auditEntries } = ctx.handle.tables;
    const row = await ctx.repos.audit.append(entry(ctx.spaceId, 10, 'd-direct'));
    await expect(
      ctx.handle.db.delete(auditEntries).where(eq(auditEntries.id, row.id)),
    ).rejects.toMatchObject(refused);
    await ctx.repos.audit.append(entry(ctx.spaceId, 90, 'd-pruned'));
    await ctx.repos.audit.prune({ spaceId: ctx.spaceId, before: daysAgo(80), limit: 1 });
    await expect(
      ctx.handle.db.delete(auditEntries).where(eq(auditEntries.id, row.id)),
    ).rejects.toMatchObject(refused);
    if (ctx.handle.kind === 'postgres') {
      // The prune function refuses anchors.
      const [anchor] = await ctx.handle.db
        .select({ id: auditEntries.id })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'audit.pruned'))
        .limit(1);
      await expect(
        ctx.handle.db.execute(sql`select audit_entries_prune(array[${anchor?.id}]::uuid[])`),
      ).rejects.toMatchObject(refused);
    } else {
      await ctx.handle.client.execute('update audit_prune_guard set active = 1 where id = 1');
      await expect(
        ctx.handle.client.execute("delete from audit_entries where action = 'audit.pruned'"),
      ).rejects.toThrow(/append-only/);
      await ctx.handle.client.execute('update audit_prune_guard set active = 0 where id = 1');
    }
  });

  it('deletes nothing when the step before the delete fails', async () => {
    const row = await ctx.repos.audit.append(entry(otherSpaceId, 90, 'x-kept'));
    const count = await ctx.repos.audit.count();
    await expect(
      ctx.repos.audit.prune({
        spaceId: otherSpaceId,
        before: daysAgo(80),
        limit: 10,
        beforeDelete: async () => {
          throw new Error('export failed');
        },
      }),
    ).rejects.toThrow('export failed');
    expect(await ctx.repos.audit.count()).toBe(count);
    expect(await ctx.repos.audit.findById(row.id)).not.toBeNull();
  });

  // Last: it breaks the chain for good.
  it('reports a gap no anchor covers', async () => {
    await ctx.repos.audit.append(entry(ctx.spaceId, 1, 'g-before'));
    const gone = await ctx.repos.audit.append(entry(ctx.spaceId, 1, 'g-gone'));
    const after = await ctx.repos.audit.append(entry(ctx.spaceId, 1, 'g-after'));
    if (ctx.handle.kind === 'postgres') {
      await ctx.handle.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('manablox.audit_prune', 'on', true)`);
        await tx.execute(sql`delete from audit_entries where id = ${gone.id}`);
      });
    } else {
      await ctx.handle.client.batch([
        'update audit_prune_guard set active = 1 where id = 1',
        { sql: 'delete from audit_entries where id = ?', args: [gone.id] },
        'update audit_prune_guard set active = 0 where id = 1',
      ]);
    }
    expect(await ctx.repos.audit.verify()).toMatchObject({
      ok: false,
      brokenAt: { id: after.id, reason: 'link' },
    });
  });
});
