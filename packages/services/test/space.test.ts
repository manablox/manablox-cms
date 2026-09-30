import { purgeTags } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentService } from '../src/environment.service.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('space', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const document = (title: string) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title,
    slug: title.toLowerCase(),
    fields: {},
  });

describe('home nomination', () => {
  it('names a document of the space and refuses one of another', async () => {
    const home = await document('Home');
    const other = await ctx.repos.spaces.create({ name: 'O', machineName: 'o', url: 'http://o' });
    await expect(ctx.spaces.setHome(other.id, home.id)).rejects.toMatchObject({
      key: 'content.notInSpace',
    });
    const saved = await ctx.spaces.setHome(ctx.spaceId, home.id);
    expect(saved.settings.homeContentId).toBe(home.id);
  });

  it('is dropped by the delete hook when the document goes, and only then', async () => {
    const home = await document('Landing');
    const bystander = await document('Bystander');
    await ctx.spaces.setHome(ctx.spaceId, home.id);

    await ctx.content.delete(ctx.spaceId, bystander.id);
    expect((await ctx.repos.spaces.findById(ctx.spaceId))?.settings.homeContentId).toBe(home.id);

    await ctx.content.delete(ctx.spaceId, home.id);
    expect((await ctx.repos.spaces.findById(ctx.spaceId))?.settings.homeContentId).toBeUndefined();
  });

  it('purges the space from the delivery cache, since no content row says the root moved', async () => {
    const home = await document('Front');
    const purges: string[][] = [];
    const off = ctx.manablox.hooks.on('cache:purge', (payload) => {
      purges.push(payload.tags);
    });

    await ctx.spaces.setHome(ctx.spaceId, home.id);
    await ctx.spaces.setHome(ctx.spaceId, null);
    expect(purges).toEqual([[`space:${ctx.spaceId}`], [`space:${ctx.spaceId}`]]);
    off();
  });
});

describe('member candidates', () => {
  it('offers only non-members, narrowed by a search, in one query', async () => {
    const member = await ctx.repos.users.create({
      name: 'Member',
      email: 'member@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    const outsider = await ctx.repos.users.create({
      name: 'Outsider',
      email: 'outsider@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    await ctx.spaces.grant(ctx.spaceId, member.id, 'editor');

    ctx.resetQueryCount();
    const all = await ctx.spaces.candidates(ctx.spaceId);
    expect(ctx.queryCount()).toBe(1);
    expect(all.map((user) => user.id)).toContain(outsider.id);
    expect(all.map((user) => user.id)).not.toContain(member.id);

    const found = await ctx.spaces.candidates(ctx.spaceId, 'outsider');
    expect(found.map((user) => user.email)).toEqual(['outsider@example.com']);
  });
});

describe('default locale', () => {
  it('is what a document written without a locale lands in, and an update keeps its own', async () => {
    const space = await ctx.spaces.create(
      {
        name: 'German',
        machineName: 'german',
        url: 'http://de',
        defaultLocale: 'de',
        locales: ['de', 'en'],
      },
      null,
    );
    const base = { spaceId: space.id, typeId: ctx.ids.article as string, fields: {} };

    const created = await ctx.content.create({ ...base, title: 'Hallo', slug: 'hallo' });
    expect(created.locale).toBe('de');

    const english = await ctx.content.create({ ...base, locale: 'en', title: 'Hi', slug: 'hi' });
    const updated = await ctx.content.update(space.id, english.id, {
      ...base,
      title: 'Hi again',
      slug: 'hi',
    });
    expect(updated.locale).toBe('en');
  });

  it('purges the delivery cache of the space when it changes, and only then', async () => {
    const purges: string[][] = [];
    const off = ctx.manablox.hooks.on('cache:purge', (payload) => {
      purges.push(payload.tags);
    });
    const space = await ctx.spaces.create(
      { name: 'Switch', machineName: 'switch', url: 'http://s', locales: ['en', 'fr'] },
      null,
    );

    await ctx.spaces.update(space.id, { name: 'Switched' });
    expect(purges).toEqual([]);
    await ctx.spaces.update(space.id, { defaultLocale: 'fr' });
    expect(purges).toEqual([[`space:${space.id}`]]);
    off();
  });
});

describe('environments', () => {
  it('gives a created space its production environment in the same transaction', async () => {
    const failed = await ctx.spaces
      .create(
        { name: 'Rolled back', machineName: 'rolled-back', url: 'http://r.test' },
        null,
        () => {
          throw new Error('fill failed');
        },
      )
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(await ctx.repos.spaces.findByMachineName('rolled-back')).toBeNull();

    const space = await ctx.spaces.create(
      { name: 'Staged', machineName: 'staged', url: 'http://s.test' },
      null,
    );
    expect(await ctx.repos.environments.listBySpace(space.id)).toMatchObject([
      { spaceId: space.id, machineName: 'production', kind: 'production' },
    ]);
  });

  it('resolves production once per process until the space tag is purged', async () => {
    const environments = new EnvironmentService(ctx.manablox, ctx.repos);
    const production = await environments.production(ctx.spaceId);
    expect(production).toMatchObject({ spaceId: ctx.spaceId, kind: 'production' });
    ctx.resetQueryCount();
    expect(await environments.production(ctx.spaceId)).toBe(production);
    expect(await environments.scope(ctx.spaceId)).toEqual({
      spaceId: ctx.spaceId,
      environmentId: production.id,
      machineName: 'production',
      production: true,
    });
    expect(ctx.queryCount()).toBe(0);

    await purgeTags(ctx.manablox, ctx.spaceId, [`space:${ctx.spaceId}`]);
    expect(await environments.production(ctx.spaceId)).toEqual(production);
    expect(ctx.queryCount()).toBe(1);

    const staging = await ctx.repos.environments.create({
      spaceId: ctx.spaceId,
      machineName: 'staging',
      name: 'Staging',
      kind: 'staging',
    });
    try {
      expect(await environments.scope(ctx.spaceId, 'staging')).toEqual({
        spaceId: ctx.spaceId,
        environmentId: staging.id,
        machineName: 'staging',
        production: false,
      });
      expect((await environments.list(ctx.spaceId)).map((e) => e.machineName)).toEqual([
        'production',
        'staging',
      ]);
      await expect(environments.scope(ctx.spaceId, 'missing')).rejects.toMatchObject({
        key: 'environment.notFound',
      });
    } finally {
      await ctx.repos.environments.delete(staging.id);
    }
  });
});

describe('the space:after hooks', () => {
  it('run once the create, a URL change and the delete committed', async () => {
    const seen: unknown[] = [];
    const offs = [
      ctx.manablox.hooks.on('space:afterCreate', (payload) => void seen.push(['create', payload])),
      ctx.manablox.hooks.on('space:afterUpdate', (payload) => void seen.push(['update', payload])),
      ctx.manablox.hooks.on('space:afterDelete', (payload) => void seen.push(['delete', payload])),
    ];
    try {
      const space = await ctx.spaces.create(
        { name: 'Hooked', machineName: 'hooked', url: 'http://hooked.test' },
        null,
      );
      await ctx.spaces.update(space.id, { url: 'https://hooked.example.com' });
      await ctx.spaces.delete(space.id);
      expect(seen).toEqual([
        ['create', { spaceId: space.id, url: 'http://hooked.test' }],
        [
          'update',
          {
            spaceId: space.id,
            url: 'https://hooked.example.com',
            previousUrl: 'http://hooked.test',
          },
        ],
        ['delete', { spaceId: space.id, url: 'https://hooked.example.com' }],
      ]);
    } finally {
      for (const off of offs) off();
    }
  });

  it('do not run for a write that rolls back, and a throwing handler is only logged', async () => {
    const seen: string[] = [];
    const offs = [
      ctx.manablox.hooks.on('space:afterUpdate', () => {
        throw new Error('handler failed');
      }),
      ctx.manablox.hooks.on('space:afterCreate', ({ spaceId }) => void seen.push(spaceId)),
    ];
    try {
      const space = await ctx.spaces.create(
        { name: 'Once', machineName: 'once', url: 'http://once.test' },
        null,
      );
      await expect(
        ctx.spaces.create({ name: 'Twice', machineName: 'once', url: 'http://twice.test' }, null),
      ).rejects.toMatchObject({ key: 'space.validation.failed' });
      expect(seen).toEqual([space.id]);
      await expect(
        ctx.spaces.update(space.id, { url: 'http://moved.test' }),
      ).resolves.toMatchObject({ url: 'http://moved.test' });
    } finally {
      for (const off of offs) off();
    }
  });
});
