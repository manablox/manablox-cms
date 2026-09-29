import { runAsActor } from '@manablox/core/node';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('audit');
});
afterAll(async () => {
  await ctx?.close();
});

const alice = { kind: 'user' as const, id: 'u-alice', label: 'alice@example.com' };

describe('AuditRepository', () => {
  it('chains each entry to the one before and verifies the whole chain', async () => {
    const first = await ctx.repos.audit.append({
      actor: alice,
      spaceId: ctx.spaceId,
      action: 'content.create',
      targetKind: 'content',
      targetId: 'c1',
      targetLabel: 'Home',
      changes: [{ path: 'title', from: undefined, to: 'Home' }],
    });
    const second = await ctx.repos.audit.append({
      actor: alice,
      spaceId: ctx.spaceId,
      action: 'content.update',
      targetKind: 'content',
      targetId: 'c1',
      targetLabel: 'Start',
      changes: [{ path: 'title', from: 'Home', to: 'Start' }],
    });
    expect(first.prevHash).toBeNull();
    expect(second.prevHash).toBe(first.hash);
    expect(second.seq).toBeGreaterThan(first.seq);

    const verified = await ctx.repos.audit.verify(1);
    expect(verified).toEqual({ ok: true, checked: 2, brokenAt: null });
  });

  it('takes the actor from the context when none is given, and the system outside one', async () => {
    const inside = await runAsActor(alice, () =>
      ctx.repos.audit.append({ action: 'menu.create', targetKind: 'menu', targetId: 'm1' }),
    );
    const outside = await ctx.repos.audit.append({
      action: 'apiKey.prune',
      targetKind: 'apiKey',
    });
    expect(inside).toMatchObject({ actorKind: 'user', actorId: 'u-alice' });
    expect(outside).toMatchObject({ actorKind: 'system', actorId: null, actorLabel: 'system' });
  });

  it('refuses to be updated, deleted or truncated', async () => {
    const entry = await ctx.repos.audit.append({
      actor: alice,
      action: 'user.update',
      targetKind: 'user',
      targetId: 'u2',
    });
    const { auditEntries } = ctx.handle.tables;
    // The trigger's message is on the cause.
    const refused = {
      cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }),
    };
    await expect(
      ctx.handle.db
        .update(auditEntries)
        .set({ targetLabel: 'tampered' })
        .where(sql`${auditEntries.id} = ${entry.id}`),
    ).rejects.toMatchObject(refused);
    await expect(
      ctx.handle.db.delete(auditEntries).where(sql`${auditEntries.id} = ${entry.id}`),
    ).rejects.toMatchObject(refused);
    if (ctx.handle.kind === 'postgres') {
      await expect(ctx.handle.db.execute(sql`truncate audit_entries`)).rejects.toMatchObject(
        refused,
      );
    }
    expect(await ctx.repos.audit.findById(entry.id)).toMatchObject({ targetLabel: null });
  });

  it('filters, searches and sorts a listing, with the space pinned', async () => {
    const other = await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'x' });
    await ctx.repos.audit.append({
      actor: { kind: 'system', id: 's1', label: 'Nightly' },
      spaceId: other.id,
      action: 'space.update',
      targetKind: 'space',
      targetId: other.id,
      targetLabel: 'Nightly',
    });
    await ctx.repos.audit.append({
      actor: alice,
      spaceId: ctx.spaceId,
      action: 'content.publish',
      targetKind: 'content',
      targetId: 'c1',
      targetLabel: 'Start',
    });

    const mine = await ctx.repos.audit.page({ spaceId: ctx.spaceId });
    expect(mine.items.every((row) => row.spaceId === ctx.spaceId)).toBe(true);
    expect(mine.items.map((row) => row.action)).toEqual([
      'content.publish',
      'content.update',
      'content.create',
    ]);

    const published = await ctx.repos.audit.page({
      spaceId: ctx.spaceId,
      actions: ['content.publish'],
    });
    expect(published.total).toBe(1);

    const searched = await ctx.repos.audit.page({ search: 'nightly' });
    expect(searched.items.map((row) => row.actorLabel)).toEqual(['Nightly']);

    const byAction = await ctx.repos.audit.page(
      { spaceId: ctx.spaceId },
      { by: 'action', direction: 'asc' },
      { limit: 2, offset: 0 },
    );
    expect(byAction.items.map((row) => row.action)).toEqual(['content.create', 'content.publish']);
    expect(byAction.total).toBe(3);

    const instanceOnly = await ctx.repos.audit.page({ spaceId: null });
    expect(instanceOnly.items.every((row) => row.spaceId === null)).toBe(true);
    expect(instanceOnly.total).toBe(3);

    const history = await ctx.repos.audit.pageByTarget({ kind: 'content', id: 'c1' });
    expect(history.items.map((row) => row.action)).toEqual([
      'content.publish',
      'content.update',
      'content.create',
    ]);
  });

  it('reports a failure to onError instead of throwing from record', async () => {
    const failures: unknown[] = [];
    const { AuditRepository } = await import('../src/repositories/audit.js');
    const broken = new AuditRepository(
      {
        ...ctx.handle,
        db: { transaction: async () => Promise.reject(new Error('down')) },
      } as never,
      { onError: (error) => failures.push(error) },
    );
    expect(await broken.record({ action: 'menu.delete', targetKind: 'menu' })).toBeNull();
    expect(failures).toHaveLength(1);
  });
});

// Last, so its entries do not shift the listing tests above.
describe('AuditRepository listeners', () => {
  it('tells `onAppended` about each committed entry, and keeps the entry when it throws', async () => {
    const { AuditRepository } = await import('../src/repositories/audit.js');
    const heard: string[] = [];
    const errors: unknown[] = [];
    const repo = new AuditRepository(ctx.handle, {
      onAppended: (row) => {
        heard.push(row.action);
        if (row.action === 'content.delete') throw new Error('listener down');
      },
      onError: (error) => errors.push(error),
    });
    const base = {
      actor: alice,
      spaceId: ctx.spaceId,
      targetKind: 'content' as const,
      targetId: 'x',
    };
    await repo.append({ ...base, action: 'content.publish' });
    const row = await repo.record({ ...base, action: 'content.delete' });

    expect(heard).toEqual(['content.publish', 'content.delete']);
    expect(row?.action).toBe('content.delete');
    expect(errors).toHaveLength(1);
    expect(await repo.findById(row?.id as string)).not.toBeNull();
  });
});
