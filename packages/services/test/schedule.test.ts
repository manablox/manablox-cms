import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScheduleService } from '../src/schedule.service.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('schedule', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

let seq = 0;
const doc = (over: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: `Scheduled ${++seq}`,
    fields: {},
    ...over,
  });

/** A scheduler driven by the test's clock. */
function schedulerAt(now: Date): ScheduleService {
  return new ScheduleService(
    ctx.manablox,
    ctx.repos,
    {
      publish: (spaceId, id) => ctx.content.publish(spaceId, id),
      unpublish: (spaceId, id) => ctx.content.unpublish(spaceId, id),
    },
    { now: () => now },
  );
}

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 3_600_000);

describe('setting a schedule', () => {
  it('stores both ends and leaves the document alone', async () => {
    const row = await doc();
    const publishAt = future();
    const unpublishAt = new Date(publishAt.getTime() + 60_000);

    const scheduled = await ctx.content.schedule(ctx.spaceId, row.id, { publishAt, unpublishAt });

    expect(scheduled.publishAt).toEqual(publishAt);
    expect(scheduled.unpublishAt).toEqual(unpublishAt);
    expect(scheduled.status).toBe('draft');
  });

  it('moves one end without restating the other, and clears with null', async () => {
    const row = await doc();
    const publishAt = future();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt, unpublishAt: null });

    const moved = await ctx.content.schedule(ctx.spaceId, row.id, {
      unpublishAt: new Date(future().getTime() + 60_000),
    });
    expect(moved.publishAt).toEqual(publishAt);

    const cleared = await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: null });
    expect(cleared.publishAt).toBeNull();
    expect(cleared.unpublishAt).not.toBeNull();
  });

  it('refuses a window that closes before it opens', async () => {
    const row = await doc();
    const publishAt = future();
    const error = await ctx.content
      .schedule(ctx.spaceId, row.id, {
        publishAt,
        unpublishAt: new Date(publishAt.getTime() - 1000),
      })
      .catch((err) => err);
    expect(error.key).toBe('content.schedule.invalidWindow');
  });

  it('records who scheduled it, and what for', async () => {
    const row = await doc();
    const publishAt = future();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt });

    const page = await ctx.repos.audit.page(
      { spaceId: ctx.spaceId, actions: ['content.schedule'] },
      { by: 'at', direction: 'desc' },
      { limit: 10, offset: 0 },
    );
    const entry = page.items.find((item) => item.targetId === row.id);
    expect(entry?.meta).toMatchObject({ publishAt: publishAt.toISOString() });
  });
});

describe('the clock', () => {
  it('publishes a document whose date has come, and clears the date', async () => {
    const row = await doc();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: past() });

    const result = await schedulerAt(new Date()).tick();

    expect(result.published).toContain(row.id);
    const after = await ctx.content.get(ctx.spaceId, row.id);
    expect(after?.status).toBe('published');
    expect(after?.publishAt).toBeNull();
    // The delivery API reads the projection.
    expect(await ctx.content.get(ctx.spaceId, row.id, { published: true })).not.toBeNull();
  });

  it('waits for a space whose import has not finished', async () => {
    const row = await doc();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: past() });
    const space = await ctx.repos.spaces.findById(ctx.spaceId);
    await ctx.repos.spaces.setImport(ctx.spaceId, 'importing', null as never);
    try {
      expect((await schedulerAt(new Date()).tick()).published).not.toContain(row.id);
    } finally {
      await ctx.repos.spaces.setImport(ctx.spaceId, space?.importStatus ?? null, null);
    }
    expect((await schedulerAt(new Date()).tick()).published).toContain(row.id);
  });

  it('leaves a document whose date is still ahead', async () => {
    const row = await doc();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: future() });

    const result = await schedulerAt(new Date()).tick();

    expect(result.published).not.toContain(row.id);
    expect((await ctx.content.get(ctx.spaceId, row.id))?.status).toBe('draft');
  });

  it('takes a published document down when its window closes', async () => {
    const row = await doc();
    await ctx.content.publish(ctx.spaceId, row.id);
    await ctx.content.schedule(ctx.spaceId, row.id, { unpublishAt: past() });

    const result = await schedulerAt(new Date()).tick();

    expect(result.unpublished).toContain(row.id);
    const after = await ctx.content.get(ctx.spaceId, row.id);
    expect(after?.status).toBe('draft');
    expect(after?.unpublishAt).toBeNull();
    expect(await ctx.content.get(ctx.spaceId, row.id, { published: true })).toBeNull();
  });

  it('ends a whole window that passed between two ticks with the document down', async () => {
    const row = await doc();
    const publishAt = new Date(Date.now() - 120_000);
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt, unpublishAt: past() });

    await schedulerAt(new Date()).tick();

    expect((await ctx.content.get(ctx.spaceId, row.id))?.status).toBe('draft');
    expect(await ctx.content.get(ctx.spaceId, row.id, { published: true })).toBeNull();
  });

  it('claims each document once, so two schedulers cannot both publish it', async () => {
    const row = await doc();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: past() });

    const at = new Date();
    const [first, second] = await Promise.all([schedulerAt(at).tick(), schedulerAt(at).tick()]);

    const claims = [...first.published, ...second.published].filter((id) => id === row.id);
    expect(claims).toHaveLength(1);
  });

  it('reports a failure and does not retry it, the date being spent', async () => {
    const row = await doc();
    await ctx.content.schedule(ctx.spaceId, row.id, { publishAt: past() });

    const failing = new ScheduleService(
      ctx.manablox,
      ctx.repos,
      {
        publish: () => Promise.reject(new Error('nope')),
        unpublish: () => Promise.resolve(),
      },
      { now: () => new Date() },
    );

    expect((await failing.tick()).failed).toContain(row.id);
    // The claim cleared the date.
    expect((await schedulerAt(new Date()).tick()).published).not.toContain(row.id);
    expect((await ctx.content.get(ctx.spaceId, row.id))?.status).toBe('draft');
  });
});

describe('a broken tick', () => {
  it('logs and carries on rather than taking the process down with it', async () => {
    const broken = new ScheduleService(
      ctx.manablox,
      {
        ...ctx.repos,
        content: {
          ...ctx.repos.content,
          claimDuePublications: () => Promise.reject(new Error('database is away')),
        },
      } as never,
      { publish: () => Promise.resolve(), unpublish: () => Promise.resolve() },
      { now: () => new Date() },
    );

    // Must resolve, not throw.
    await expect(broken.tick()).resolves.toEqual({ published: [], unpublished: [], failed: [] });
  });
});

describe('publishing by hand', () => {
  it('spends the publish date and keeps the takedown', async () => {
    const row = await doc();
    const unpublishAt = future();
    await ctx.content.schedule(ctx.spaceId, row.id, {
      publishAt: future(),
      unpublishAt: new Date(unpublishAt.getTime() + 60_000),
    });

    await ctx.content.publish(ctx.spaceId, row.id);

    const after = await ctx.content.get(ctx.spaceId, row.id);
    expect(after?.publishAt).toBeNull();
    expect(after?.unpublishAt).not.toBeNull();
    // The projection must not carry a pending publish date.
    expect((await ctx.content.get(ctx.spaceId, row.id, { published: true }))?.publishAt).toBeNull();
  });

  it('clears the takedown when the document is unpublished by hand', async () => {
    const row = await doc();
    await ctx.content.publish(ctx.spaceId, row.id);
    await ctx.content.schedule(ctx.spaceId, row.id, { unpublishAt: future() });

    await ctx.content.unpublish(ctx.spaceId, row.id);

    expect((await ctx.content.get(ctx.spaceId, row.id))?.unpublishAt).toBeNull();
  });
});
