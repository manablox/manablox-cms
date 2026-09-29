import { randomUUID } from 'node:crypto';
import { databaseContextOf } from '@manablox/db';
import { createServiceContext, type ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type WebhookRepository, webhookRepos, webhookTables } from '../src/server/db/index.js';
import { webhooksPlugin } from '../src/server/plugin.js';

let ctx: ServiceContext;
let repo: WebhookRepository;
let environmentId: string;

/** Rows inserted as given, into the plugin's tables. */
const db = () => {
  const context = databaseContextOf(ctx.repos);
  return { db: context.db, tables: webhookTables(context) };
};

beforeAll(async () => {
  // A database with the plugin's tables; the repository needs nothing else of the plugin.
  ctx = await createServiceContext('webhook_db', {
    fieldTypes: [],
    contentTypes: [{ name: 'page', fields: [] }],
    config: { plugins: [webhooksPlugin()] },
  });
  repo = webhookRepos(ctx.repos);
  environmentId = (await ctx.repos.environments.production(ctx.spaceId))?.id as string;
});
afterAll(async () => {
  await ctx?.close();
});

const DAY = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
let counter = 0;

/** A fresh space with a staging environment. */
async function spaceWithStaging() {
  const name = `env-${++counter}`;
  const space = await ctx.repos.spaces.create({ name, machineName: name, url: 'http://e.test' });
  const production = await ctx.repos.environments.production(space.id);
  const staging = await ctx.repos.environments.create({
    spaceId: space.id,
    machineName: 'staging',
    name: 'Staging',
    kind: 'staging',
    createdFrom: production?.id,
    createdMode: 'config',
  });
  return { spaceId: space.id, staging: { spaceId: space.id, environmentId: staging.id } };
}

describe('webhooks', () => {
  it('lists only the switched-on webhooks of a space and logs deliveries', async () => {
    const { db: handle, tables } = db();
    const { webhooks } = tables;
    const [on, off] = await handle
      .insert(webhooks)
      .values([
        {
          spaceId: ctx.spaceId,
          environmentId,
          name: 'On',
          slug: 'on',
          url: 'https://on.test',
          events: [],
        },
        {
          spaceId: ctx.spaceId,
          environmentId,
          name: 'Off',
          slug: 'off',
          url: 'https://off.test',
          events: [],
          enabled: false,
        },
      ])
      .returning();

    const enabled = await repo.listEnabledBySpace(ctx.spaceId);
    expect(enabled.map((row) => row.id)).toEqual([on?.id]);
    expect(await repo.findById(off?.id as string)).toMatchObject({ enabled: false });

    await repo.createDelivery({
      webhookId: on?.id as string,
      event: 'content.published',
      payload: { id: 'x' },
      status: 200,
      error: null,
    });
    await repo.createDelivery({
      webhookId: on?.id as string,
      event: 'content.published',
      payload: { id: 'y' },
      status: null,
      error: 'ECONNREFUSED',
    });
    // Newest first.
    const log = await repo.pageDeliveries(on?.id as string);
    expect(log.items.map((row) => [row.status, row.error])).toEqual([
      [null, 'ECONNREFUSED'],
      [200, null],
    ]);

    await repo.keepDeliveries(on?.id as string, 1);
    expect((await repo.pageDeliveries(on?.id as string)).total).toBe(1);
  });

  it('finds an incoming endpoint by its slug, and keeps the two directions apart', async () => {
    const { db: handle, tables } = db();
    const { webhooks } = tables;
    const [incoming] = await handle
      .insert(webhooks)
      .values([
        {
          spaceId: ctx.spaceId,
          environmentId,
          direction: 'incoming',
          name: 'From the shop',
          slug: 'shop',
        },
        // Same slug, other direction: no clash.
        {
          spaceId: ctx.spaceId,
          environmentId,
          direction: 'outgoing',
          name: 'To the shop',
          slug: 'shop',
        },
      ])
      .returning();

    expect(await repo.findIncomingBySlug(ctx.spaceId, 'shop')).toMatchObject({
      id: incoming?.id,
      direction: 'incoming',
    });
    expect(await repo.findIncomingBySlug(ctx.spaceId, 'nope')).toBeNull();
    // Fan-out never includes incoming endpoints.
    const enabled = await repo.listEnabledBySpace(ctx.spaceId);
    expect(enabled.every((row) => row.direction === 'outgoing')).toBe(true);
  });

  it('lists endpoints per space in one pass, grouped like the single-space reads', async () => {
    const other = await ctx.repos.spaces.create({
      name: 'Other',
      machineName: 'other',
      url: 'http://o.test',
    });
    await repo.create({
      spaceId: other.id,
      direction: 'incoming',
      name: 'Owned',
      slug: 'owned',
      source: 'code',
    });

    const missing = randomUUID();
    const all = await repo.listBySpaces([ctx.spaceId, other.id, missing]);
    expect(all.get(ctx.spaceId)).toEqual(await repo.listBySpace(ctx.spaceId));
    expect(all.get(other.id)?.map((row) => row.slug)).toEqual(['owned']);
    expect(all.get(missing)).toEqual([]);

    const incoming = await repo.listBySpaces([ctx.spaceId, other.id], 'incoming');
    expect(incoming.get(ctx.spaceId)).toEqual(await repo.listBySpace(ctx.spaceId, 'incoming'));
    expect(incoming.get(ctx.spaceId)?.every((row) => row.direction === 'incoming')).toBe(true);
  });
  it("pages a space's webhooks by direction then name, with the total", async () => {
    const { db: handle, tables } = db();
    const { webhooks } = tables;
    const space = await ctx.repos.spaces.create({
      name: 'Paged',
      machineName: 'paged',
      url: 'http://p.test',
    });
    const environment = await ctx.repos.environments.production(space.id);
    await handle.insert(webhooks).values(
      ['c', 'a', 'b'].map((name) => ({
        spaceId: space.id,
        environmentId: environment?.id as string,
        direction: 'incoming' as const,
        name,
        slug: name,
      })),
    );
    await repo.create({ spaceId: space.id, name: 'out', url: 'https://o.test' });

    const first = await repo.pageBySpace(space.id, undefined, {
      limit: 2,
      offset: 0,
    });
    expect(first.total).toBe(4);
    expect(first.items.map((row) => row.name)).toEqual(['a', 'b']);
    const rest = await repo.pageBySpace(space.id, undefined, { limit: 2, offset: 2 });
    expect(rest.items.map((row) => row.name)).toEqual(['c', 'out']);
    const outgoing = await repo.pageBySpace(space.id, 'outgoing', {
      limit: 10,
      offset: 0,
    });
    expect(outgoing).toMatchObject({ total: 1, items: [{ name: 'out' }] });
  });
});

describe('webhooks across environments', () => {
  it('never returns staging endpoints to production reads', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    const webhook = await repo.create({
      ...staging,
      direction: 'incoming',
      name: 'Shop',
      slug: 'shop',
    });
    await repo.create({ ...staging, name: 'Out', url: 'https://o.test' });

    expect(await repo.listBySpace(spaceId)).toEqual([]);
    expect(await repo.listEnabledBySpace(spaceId)).toEqual([]);
    expect(await repo.findIncomingBySlug(spaceId, 'shop')).toBeNull();
    expect((await repo.listBySpaces([spaceId])).get(spaceId)).toEqual([]);
    // The staging scope reads its own rows.
    expect((await repo.findIncomingBySlug(staging, 'shop'))?.id).toBe(webhook.id);
    expect((await repo.listByEnvironment(staging.environmentId)).map((row) => row.name)).toEqual(
      expect.arrayContaining(['Shop', 'Out']),
    );
  });

  it('takes the same slug in another environment, never twice in one', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    for (const scope of [{ spaceId }, staging]) {
      await repo.create({ ...scope, direction: 'incoming', name: 'Shop', slug: 'shop' });
    }
    await expect(
      repo.create({ ...staging, direction: 'incoming', name: 'Again', slug: 'shop' }),
    ).rejects.toThrow();
  });

  it('counts only production endpoints toward the limit', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    for (const scope of [{ spaceId }, staging]) {
      await repo.create({ ...scope, name: 'Out', url: 'https://o.test' });
    }
    expect(await repo.countProduction([spaceId])).toBe(1);
    expect(await repo.countProduction([])).toBe(0);
  });

  it('deletes a staging environment with its endpoints', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    await repo.create({ ...staging, name: 'Out', url: 'https://o.test' });
    expect(await ctx.repos.environments.delete(staging.environmentId)).toBe(true);
    expect(await repo.listByEnvironment(staging.environmentId)).toEqual([]);
    expect(await repo.listBySpaces([spaceId], undefined, 'all')).toEqual(new Map([[spaceId, []]]));
  });
});

describe('delivery age cutoffs', () => {
  it('prunes webhook deliveries by age as well as by count', async () => {
    const webhook = await repo.create({ spaceId: ctx.spaceId, name: 'Aged' });
    const { db: handle, tables } = db();
    const delivery = (age: number) => ({
      webhookId: webhook.id,
      spaceId: ctx.spaceId,
      event: 'content.publish',
      payload: {},
      status: 200,
      createdAt: daysAgo(age),
    });
    await handle.insert(tables.webhookDeliveries).values([delivery(30), delivery(20), delivery(1)]);
    expect(
      await repo.pruneDeliveries({ spaceId: ctx.spaceId, before: daysAgo(10), limit: 10 }),
    ).toBe(2);
    expect((await repo.pageDeliveries(webhook.id)).total).toBe(1);
  });
});
