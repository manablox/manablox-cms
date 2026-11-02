import { randomUUID } from 'node:crypto';
import { builtinFieldTypes } from '@manablox/fields';
import { withControls } from '@manablox/services/testing';
import { defaultTheme } from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_retention', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const freshSpace = async () => {
  const machineName = `ret-${randomUUID().slice(0, 8)}`;
  return (await ctx.spaces.create({ name: machineName, machineName, url: 'http://r.test' }, null))
    .id;
};

const withScopes = async (
  entries: Array<[{ kind: 'space'; id: string }, Record<string, unknown>]>,
) => {
  const restores: Array<() => Promise<void>> = [];
  for (const [scope, values] of entries) restores.push(await withControls(ctx, { scope, values }));
  return async () => {
    for (const restore of restores.reverse()) await restore();
  };
};

describe('site design versions', () => {
  it('keeps the newest publishes by count', async () => {
    const spaceId = await freshSpace();
    const restore = await withScopes([
      [{ kind: 'space', id: spaceId }, { 'retention.plugins.website.designVersionsCount': 2 }],
    ]);
    try {
      let version = 0;
      let id = '';
      for (let i = 0; i < 3; i++) {
        const draft = await ctx.website.designs.saveDraft(spaceId, {
          kind: 'theme',
          key: 'default',
          draft: defaultTheme(),
          expectedVersion: version,
        });
        id = draft.id;
        version = (await ctx.website.designs.publish(spaceId, draft.id)).version;
      }
      expect((await ctx.website.designs.versions(spaceId, id)).map((v) => v.version)).toEqual([
        version,
        version - 1,
      ]);
    } finally {
      await restore();
    }
  });
});
