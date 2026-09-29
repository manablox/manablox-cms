import { randomUUID } from 'node:crypto';
import { ManabloxError, type ManabloxHooks } from '@manablox/core';
import type { UserRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import type { TransferSelection } from '../src/transfer/format.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let user: UserRow;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('refusing_hooks', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  user = await ctx.repos.users.create({
    name: 'Refused',
    email: 'refused@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
});
afterAll(async () => {
  await ctx?.close();
});

const refusal = () => ManabloxError.forbidden('auth.forbidden');

/** Registers a refusing handler for one call of `run`; returns the payloads it saw. */
async function refused<K extends keyof ManabloxHooks & string>(
  hook: K,
  run: () => Promise<unknown>,
): Promise<ManabloxHooks[K][0][]> {
  const seen: ManabloxHooks[K][0][] = [];
  const off = ctx.manablox.hooks.on(hook, (payload) => {
    seen.push(payload);
    throw refusal();
  });
  try {
    await expect(run()).rejects.toMatchObject({ key: 'auth.forbidden' });
  } finally {
    off();
  }
  return seen;
}

const freshSpace = async (locales = ['en']) => {
  const name = `refuse-${++counter}`;
  return (
    await ctx.repos.spaces.create({
      name,
      machineName: name,
      url: 'http://t.test',
      defaultLocale: locales[0] as string,
      locales,
    })
  ).id;
};

describe('refusing hooks', () => {
  it('space:beforeCreate refuses a new space and an import', async () => {
    const before = (await ctx.repos.spaces.list()).length;
    const seen = await refused('space:beforeCreate', () =>
      ctx.spaces.create(
        { name: 'Nope', machineName: 'nope', url: 'http://n.test', locales: ['en', 'de'] },
        user.id,
      ),
    );
    expect(seen).toEqual([
      { name: 'Nope', machineName: 'nope', url: 'http://n.test', locales: ['en', 'de'] },
    ]);

    const payload = await ctx.spaces.export(ctx.spaceId);
    const copy = {
      ...payload,
      space: { ...payload.space, id: randomUUID(), machineName: 'imported-nope' },
    };
    const imported = await refused('space:beforeCreate', () => ctx.spaces.import(copy, user.id));
    expect(imported[0]).toMatchObject({ machineName: 'imported-nope' });
    expect((await ctx.repos.spaces.list()).length).toBe(before);
  });

  it('member:beforeGrant refuses grants, bulk adds and the owner of a new space', async () => {
    const spaceId = await freshSpace();
    const seen = await refused('member:beforeGrant', () =>
      ctx.spaces.grant(spaceId, user.id, 'editor'),
    );
    expect(seen).toEqual([{ spaceId, userId: user.id, role: 'editor', previous: null }]);
    await refused('member:beforeGrant', () => ctx.spaces.addMembers(spaceId, [user.id], 'editor'));
    expect(await ctx.repos.users.findSpaceRole(user.id, spaceId)).toBeNull();

    await ctx.spaces.grant(spaceId, user.id, 'editor');
    const changed = await refused('member:beforeGrant', () =>
      ctx.spaces.grant(spaceId, user.id, 'admin'),
    );
    expect(changed[0]).toMatchObject({ role: 'admin', previous: 'editor' });
    expect(await ctx.repos.users.findSpaceRole(user.id, spaceId)).toBe('editor');

    await refused('member:beforeGrant', () =>
      ctx.spaces.create({ name: 'Owned', machineName: 'owned', url: 'http://o.test' }, user.id),
    );
    expect(await ctx.repos.spaces.findByMachineName('owned')).toBeNull();
  });

  it('space:beforeLocalesChange refuses a change of locales only', async () => {
    const spaceId = await freshSpace(['en']);
    const seen = await refused('space:beforeLocalesChange', () =>
      ctx.spaces.update(spaceId, { locales: ['en', 'de'] }),
    );
    expect(seen).toEqual([{ spaceId, locales: ['en', 'de'], previous: ['en'] }]);
    expect((await ctx.repos.spaces.findById(spaceId))?.locales).toEqual(['en']);

    const off = ctx.manablox.hooks.on('space:beforeLocalesChange', () => {
      throw refusal();
    });
    try {
      await expect(ctx.spaces.update(spaceId, { name: 'Renamed' })).resolves.toBeDefined();
    } finally {
      off();
    }
  });

  it('menu:beforeCreate refuses a menu', async () => {
    const spaceId = await freshSpace();
    const seen = await refused('menu:beforeCreate', () =>
      ctx.menus.create({ spaceId, name: 'Main', machineName: 'main' }),
    );
    expect(seen).toEqual([{ spaceId, name: 'Main', machineName: 'main' }]);
    expect(await ctx.menus.list(spaceId)).toEqual([]);
  });

  it('redirect:beforeCreate refuses a manual redirect', async () => {
    const spaceId = await freshSpace();
    const seen = await refused('redirect:beforeCreate', () =>
      ctx.redirects.create(spaceId, { fromPath: '/old/', toPath: '/new' }),
    );
    expect(seen).toEqual([{ spaceId, locale: null, fromPath: '/old', source: 'manual' }]);
    expect(await ctx.redirects.lookup(spaceId, 'en', '/old')).toBeNull();
  });

  it('redirect:beforeCreate sees automatic redirects; a refused one is skipped, the publish goes on', async () => {
    const spaceId = await freshSpace();
    const doc = await ctx.content.create({
      spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Moved',
      slug: 'old',
      fields: {},
    });
    await ctx.content.publish(spaceId, doc.id);
    await ctx.content.update(spaceId, doc.id, {
      spaceId,
      typeId: doc.typeId,
      locale: 'en',
      title: 'Moved',
      slug: 'new',
      fields: {},
    });
    const seen: ManabloxHooks['redirect:beforeCreate'][0][] = [];
    const off = ctx.manablox.hooks.on('redirect:beforeCreate', (payload) => {
      seen.push(payload);
      throw refusal();
    });
    try {
      await ctx.content.publish(spaceId, doc.id);
    } finally {
      off();
    }
    expect(seen).toEqual([{ spaceId, locale: 'en', fromPath: '/old', source: 'auto' }]);
    expect((await ctx.repos.content.findById(doc.id, true))?.permalink).toBe('new');
    expect(await ctx.redirects.lookup(spaceId, 'en', '/old')).toBeNull();
  });

  it('an import runs the per-row hooks before writing; a refusal leaves nothing behind', async () => {
    const sourceId = await freshSpace();
    await ctx.menus.create({ spaceId: sourceId, name: 'Main', machineName: 'main' });
    await ctx.redirects.create(sourceId, { fromPath: '/old', toPath: '/new' });
    const restored: TransferSelection = { sections: ['menus', 'redirects'] };
    const payload = await ctx.spaces.export(sourceId, restored);
    // Ids travel, so the source makes room.
    await ctx.spaces.delete(sourceId);
    const spaceId = payload.space.id;

    const hooks = ['menu:beforeCreate', 'redirect:beforeCreate'] as const;
    const seen: Array<[string, unknown]> = [];
    const offs = hooks.map((hook) =>
      ctx.manablox.hooks.on(hook, (row: unknown) => {
        seen.push([hook, row]);
      }),
    );
    const refuse = ctx.manablox.hooks.on('redirect:beforeCreate', () => {
      throw refusal();
    });
    try {
      await expect(ctx.spaces.import(payload, user.id, restored)).rejects.toMatchObject({
        key: 'auth.forbidden',
      });
      expect(await ctx.repos.spaces.findById(spaceId)).toBeNull();
      expect(await ctx.repos.menus.listBySpace(spaceId)).toEqual([]);
      refuse();
      seen.length = 0;
      await ctx.spaces.import(payload, user.id, restored);
    } finally {
      for (const off of offs) off();
      refuse();
    }
    expect(seen).toEqual([
      ['menu:beforeCreate', { spaceId, name: 'Main', machineName: 'main' }],
      ['redirect:beforeCreate', { spaceId, locale: null, fromPath: '/old', source: 'manual' }],
    ]);
    expect(await ctx.repos.menus.listBySpace(spaceId)).toHaveLength(1);
  });
});
