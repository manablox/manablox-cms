import { EnvironmentService } from '@manablox/services';
import { createServiceContext, type ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RpcContext } from '../src/context.js';
import { contentRouter } from '../src/routers/content.js';
import { failure, invoke, principal, stubContext } from './helpers/rpc.js';

let ctx: ServiceContext;
let spaceA: string;
let docId: string;

beforeAll(async () => {
  ctx = await createServiceContext('rpc_content_spaces', {
    fieldTypes: [],
    contentTypes: [{ name: 'page', fields: [] }],
  });
  spaceA = (await ctx.repos.spaces.create({ name: 'A', machineName: 'a', url: 'http://a' })).id;
  const doc = await ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.page as string,
    locale: 'en',
    title: 'Elsewhere',
    slug: 'elsewhere',
    fields: {},
  });
  docId = doc.id;
  await ctx.content.publish(ctx.spaceId, docId);
});
afterAll(async () => {
  await ctx?.close();
});

/** An editor of `spaceId` holding every content grant, untyped. */
function contextIn(spaceId: string): RpcContext {
  return stubContext({
    manablox: ctx.manablox,
    repos: ctx.repos,
    content: ctx.content,
    approvals: ctx.approvals,
    tags: ctx.tags,
    environments: new EnvironmentService(ctx.manablox, ctx.repos),
    principal: principal({
      spaces: { [spaceId]: 'editor' },
      permissions: {
        [spaceId]: [
          'space:read',
          'contentType:read',
          'content:read',
          'content:write',
          'content:delete',
          'content:publish',
        ],
      },
    }),
  } as Partial<RpcContext>);
}

describe('content procedures across spaces', () => {
  it("answers not found for another space's document on every procedure taking an id", async () => {
    const context = contextIn(spaceA);
    const id = docId;
    const typeId = ctx.ids.page as string;
    const calls: [string, unknown, Record<string, unknown>][] = [
      ['ancestors', contentRouter.ancestors, { id }],
      ['update', contentRouter.update, { id, typeId, title: 'Taken', slug: 'taken', fields: {} }],
      ['delete', contentRouter.delete, { id }],
      ['publish', contentRouter.publish, { id }],
      ['unpublish', contentRouter.unpublish, { id }],
      ['schedule', contentRouter.schedule, { id, publishAt: null }],
      ['move', contentRouter.move, { id, parentId: null, position: 0 }],
      ['translations', contentRouter.translations, { id }],
      ['createTranslation', contentRouter.createTranslation, { id, locale: 'de' }],
      ['duplicate', contentRouter.duplicate, { id }],
      ['approval', contentRouter.approval, { id }],
      ['requestApproval', contentRouter.requestApproval, { id }],
      ['withdrawApproval', contentRouter.withdrawApproval, { id }],
      ['approve', contentRouter.approve, { id }],
      ['reject', contentRouter.reject, { id }],
      ['versions', contentRouter.versions, { id }],
      ['versionSnapshot', contentRouter.versionSnapshot, { id, version: 1 }],
      ['restore', contentRouter.restore, { id, version: 1 }],
    ];

    for (const [name, procedure, input] of calls) {
      const error = await failure(invoke(procedure, { spaceId: spaceA, ...input }, context));
      expect({ name, ...error }).toMatchObject({ name, code: 'NOT_FOUND' });
    }
    expect(await invoke(contentRouter.get, { spaceId: spaceA, id }, context)).toBeNull();

    const row = await ctx.repos.content.findById(id);
    expect(row).toMatchObject({ title: 'Elsewhere', status: 'published' });
    expect(await ctx.repos.content.findById(id, true)).not.toBeNull();
  });

  it('serves the same document to an editor of its own space', async () => {
    const context = contextIn(ctx.spaceId);
    const row = await invoke<{ id: string }>(
      contentRouter.get,
      { spaceId: ctx.spaceId, id: docId },
      context,
    );
    expect(row.id).toBe(docId);
    const versions = await invoke<{ items: unknown[]; total: number }>(
      contentRouter.versions,
      { spaceId: ctx.spaceId, id: docId },
      context,
    );
    expect(versions.items.length).toBeGreaterThan(0);
    expect(versions.total).toBe(versions.items.length);
  });
});
