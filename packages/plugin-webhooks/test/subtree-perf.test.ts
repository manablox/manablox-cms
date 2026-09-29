import { purgeLocal } from '@manablox/cache';
import type { ContentRow } from '@manablox/db';
import type { WorkflowEngine, WorkflowTrigger } from '@manablox/plugin-workflows';
import { attachAssetUsages } from '@manablox/services';
import type { ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebhookDelivery } from '../src/server/services/webhook.service.js';
import { action, chain } from './helpers/graph.js';
import { createWebhookHarness } from './helpers/harness.js';

/**
 * Statements an unpublish or delete of a subtree issues with live workflows, outgoing
 * webhooks and asset usages listening. `PERF=1` prints numbers.
 */
const SMALL = 5;
const LARGE = 20;
const WORKFLOWS = 5;
const WEBHOOKS = 3;

let ctx: ServiceContext;
let engine: WorkflowEngine;
let queued: WebhookDelivery[];

let seq = 0;
const graph = () =>
  chain(
    action(`step${++seq}`, 'email', {
      to: ['ops@example.com'],
      toRoles: [],
      subject: 'hi',
      body: 'there',
      html: false,
    }),
  );

beforeAll(async () => {
  // The plugins' services provided as in the host: content hooks queue outgoing deliveries.
  const h = await createWebhookHarness('webhook_subtree_perf', {
    contentTypes: [
      { name: 'page', fields: [] },
      { name: 'post', fields: [] },
    ],
    engine: { now: () => new Date() },
  });
  ({ ctx, engine, queued } = h);
  const { service: workflows, webhooks } = h;
  attachAssetUsages(ctx.manablox, ctx.content);

  // Live, but listening for posts, so no page event starts or aborts a run.
  const onPosts: WorkflowTrigger = {
    kind: 'event',
    events: ['content.unpublished', 'content.deleted'],
    typeIds: [ctx.ids.post as string],
    locales: [],
  };
  for (let index = 0; index < WORKFLOWS; index++) {
    await workflows.create(
      ctx.spaceId,
      { name: `On posts ${index}`, trigger: onPosts, ...graph(), enabled: true },
      { publish: true },
    );
  }
  for (let index = 0; index < WEBHOOKS; index++) {
    await webhooks.create(ctx.spaceId, {
      direction: 'outgoing',
      name: `Hook ${index}`,
      url: `https://hook${index}.test`,
      events: [],
    });
  }
}, 300_000);

afterAll(async () => {
  await ctx?.close();
});

/** A published page with `size` published children. */
async function subtree(name: string, size: number): Promise<ContentRow> {
  const page = (title: string, parentId: string | null) =>
    ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.page as string,
      locale: 'en',
      parentId,
      title,
      slug: title.toLowerCase().replace(/\s+/g, '-'),
      fields: {},
    });
  const root = await page(name, null);
  await ctx.content.publish(ctx.spaceId, root.id);
  for (let index = 0; index < size; index++) {
    const child = await page(`${name} ${index}`, root.id);
    await ctx.content.publish(ctx.spaceId, child.id);
  }
  return root;
}

/**
 * Statements `run` issues, with every per-space lookup cold: lookups kept in process for
 * seconds, such as the enabled endpoints, would otherwise expire at a random point between
 * two measurements and be read in only one of them.
 */
async function measure(label: string, run: () => Promise<unknown>): Promise<number> {
  engine.forgetLive();
  purgeLocal(ctx.manablox);
  ctx.resetQueryCount();
  await run();
  await engine.idle();
  // Control reads are cached for seconds, so one may expire between two measurements.
  const count = ctx.queries().filter((query) => !/"control_settings"/.test(query)).length;
  if (process.env.PERF) {
    console.log(`[perf] ${label}: ${count} statements`);
    const groups = new Map<string, number>();
    for (const query of ctx.queries()) {
      const shape = query.replace(/\s+/g, ' ').trim().slice(0, 70);
      groups.set(shape, (groups.get(shape) ?? 0) + 1);
    }
    for (const [shape, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${String(n).padStart(4)}  ${shape}`);
    }
  }
  return count;
}

const statementsLike = (pattern: RegExp) =>
  ctx.queries().filter((query) => pattern.test(query)).length;

describe(`a subtree with ${WORKFLOWS} live workflows and ${WEBHOOKS} webhooks`, () => {
  it('unpublishes in a number of statements independent of its size', async () => {
    const small = await subtree('Small', SMALL);
    const large = await subtree('Large', LARGE);

    const smallCount = await measure(`unpublish ${SMALL} descendants`, () =>
      ctx.content.unpublish(ctx.spaceId, small.id),
    );
    queued.length = 0;
    const largeCount = await measure(`unpublish ${LARGE} descendants`, () =>
      ctx.content.unpublish(ctx.spaceId, large.id),
    );

    expect(largeCount).toBe(smallCount);
    expect(largeCount).toBeLessThanOrEqual(20);
    expect(statementsLike(/"workflows_versions"/)).toBe(1);
    // The enabled endpoints are read once for the whole subtree.
    expect(statementsLike(/"webhooks"/)).toBe(1);
    expect(statementsLike(/update "asset_usages"/)).toBe(1);
    // Every row still reaches every webhook.
    expect(queued).toHaveLength((LARGE + 1) * WEBHOOKS);
    expect(new Set(queued.map((delivery) => delivery.event))).toEqual(
      new Set(['content.unpublished']),
    );
    // Every row is still audited, in one chained write.
    const { items: entries } = await ctx.repos.audit.pageByTarget({
      kind: 'content',
      id: large.id,
    });
    expect(entries[0]?.action).toBe('content.unpublish');
    expect((await ctx.repos.audit.verify()).ok).toBe(true);
  });

  it('deletes in a number of statements independent of its size', async () => {
    const small = await subtree('Gone small', SMALL);
    const large = await subtree('Gone large', LARGE);

    const smallCount = await measure(`delete ${SMALL} descendants`, () =>
      ctx.content.delete(ctx.spaceId, small.id),
    );
    queued.length = 0;
    const largeCount = await measure(`delete ${LARGE} descendants`, () =>
      ctx.content.delete(ctx.spaceId, large.id),
    );

    expect(statementsLike(/delete from "content_tags"/)).toBe(1);
    expect(largeCount).toBe(smallCount);
    expect(largeCount).toBeLessThanOrEqual(20);
    expect(statementsLike(/"workflows_versions"/)).toBe(1);
    // The enabled endpoints are read once for the whole subtree.
    expect(statementsLike(/"webhooks"/)).toBe(1);
    expect(queued).toHaveLength((LARGE + 1) * WEBHOOKS);
    expect((await ctx.repos.audit.verify()).ok).toBe(true);
  });
});
