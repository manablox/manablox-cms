import { ManabloxError } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;
let userId: string;
let counter = 0;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_hooks', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  userId = (
    await ctx.repos.users.create({
      name: 'Importer',
      email: 'importer@example.com',
      role: 'editor',
      passwordHash: 'x',
    })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

const refusal = () => ManabloxError.forbidden('auth.forbidden');

const freshSpace = async () => {
  const name = `site-hooks-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

describe('website hooks', () => {
  it('website:beforeDomainCreate refuses a host name', async () => {
    const spaceId = await freshSpace();
    const seen: unknown[] = [];
    const off = ctx.manablox.hooks.on('website:beforeDomainCreate', (payload) => {
      seen.push(payload);
      throw refusal();
    });
    try {
      await expect(
        ctx.website.domains.create(spaceId, { hostname: 'Refused.test' }),
      ).rejects.toMatchObject({ key: 'auth.forbidden' });
    } finally {
      off();
    }
    expect(seen).toEqual([{ spaceId, hostname: 'refused.test', locale: null }]);
    expect(await ctx.website.domains.list(spaceId)).toEqual([]);
  });

  it('an import asks it for every domain before writing, after core hooks', async () => {
    const sourceId = await freshSpace();
    await ctx.menus.create({ spaceId: sourceId, name: 'Main', machineName: 'main' });
    await ctx.website.domains.create(sourceId, { hostname: 'import-hooks.test' });
    // Host names are restored only when asked for.
    const restored = { sections: ['menus', 'website.domains'] };
    const payload = await ctx.spaces.export(sourceId, restored);
    // Ids and host names travel, so the source makes room.
    await ctx.spaces.delete(sourceId);
    const spaceId = payload.space.id;

    const seen: Array<[string, unknown]> = [];
    const offs = (['menu:beforeCreate', 'website:beforeDomainCreate'] as const).map((hook) =>
      ctx.manablox.hooks.on(hook, (row: unknown) => {
        seen.push([hook, row]);
      }),
    );
    try {
      await ctx.spaces.import(payload, userId, restored);
    } finally {
      for (const off of offs) off();
    }
    expect(seen).toEqual([
      ['menu:beforeCreate', { spaceId, name: 'Main', machineName: 'main' }],
      ['website:beforeDomainCreate', { spaceId, hostname: 'import-hooks.test', locale: null }],
    ]);
    expect(await ctx.website.domains.list(spaceId)).toHaveLength(1);
  });
});
