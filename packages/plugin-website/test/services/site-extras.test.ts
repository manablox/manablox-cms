import { builtinFieldTypes } from '@manablox/fields';
import { spaceGroup, withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { siteCacheTags } from '../../src/shared/site.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g';

let ctx: WebsiteContext;
/** Tags of every `cache:purge` since the last `take`. */
let purged: string[][] = [];
const take = () => {
  const out = purged;
  purged = [];
  return out;
};

beforeAll(async () => {
  ctx = await createWebsiteContext('site_extras', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  ctx.manablox.hooks.on('cache:purge', ({ tags }) => {
    purged.push(tags);
  });
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const freshSpace = async () => {
  const name = `extras-${++counter}`;
  return (
    await ctx.repos.spaces.create({
      name,
      machineName: name,
      url: 'http://t.test',
      defaultLocale: 'en',
      locales: ['en'],
    })
  ).id;
};

describe('site badge controls', () => {
  it('purges the pages of the scope written: instance, group, space', async () => {
    const [a, b, c] = [await freshSpace(), await freshSpace(), await freshSpace()];
    const group = await spaceGroup(ctx, [a, b], 'Badge group');
    take();

    const instance = await withControls(ctx, { features: { 'plugins.website.badge': true } });
    expect(take().flat()).toEqual(
      expect.arrayContaining([siteCacheTags.design(a), siteCacheTags.design(c)]),
    );
    await instance();
    expect(take().flat()).toContain(siteCacheTags.design(c));

    const grouped = await withControls(ctx, {
      scope: group,
      values: { 'plugins.website.badge.text': 'Built with us' },
    });
    const groupTags = take().flat();
    expect(groupTags).toEqual(
      expect.arrayContaining([siteCacheTags.design(a), siteCacheTags.design(b)]),
    );
    expect(groupTags).not.toContain(siteCacheTags.design(c));
    await grouped();
    take();

    await ctx.controls.set(
      { kind: 'space', id: c },
      'plugins.website.badge.link',
      'https://example.com/',
    );
    expect(take()).toContainEqual([siteCacheTags.design(c)]);
    await ctx.controls.delete({ kind: 'space', id: c }, 'plugins.website.badge.link');
    expect(take()).toContainEqual([siteCacheTags.design(c)]);

    // Other keys, and writes that change nothing, leave the pages alone.
    await ctx.controls.set({ kind: 'space', id: c }, 'features.menus', { enabled: false });
    await ctx.controls.set({ kind: 'space', id: c }, 'features.menus', { enabled: false });
    expect(take().flat()).not.toContain(siteCacheTags.design(c));
    await ctx.controls.delete({ kind: 'space', id: c }, 'features.menus');

    // A space joining or leaving a group may change its badge.
    take();
    await ctx.controls.assignSpaces({ id: group.id }, [c]);
    expect(take().flat()).toContain(siteCacheTags.design(c));
    await ctx.controls.deleteGroup({ id: group.id });
    expect(take().flat()).toEqual(
      expect.arrayContaining([siteCacheTags.design(a), siteCacheTags.design(b)]),
    );
  });
});

describe('site password', () => {
  it('stores the hash, keeps it through other writes and audits no hash', async () => {
    const spaceId = await freshSpace();
    await ctx.website.settings.set(spaceId, { mode: 'designed', passwordHash: HASH });
    expect((await ctx.website.settings.get(spaceId)).password).toBe(HASH);

    await ctx.website.settings.set(spaceId, { localeStrategy: 'domain' });
    await ctx.spaces.update(spaceId, { settings: { other: 1 } });
    expect((await ctx.website.settings.get(spaceId)).password).toBe(HASH);

    await ctx.website.settings.set(spaceId, { passwordHash: `${HASH}x` });
    await ctx.website.settings.set(spaceId, { passwordHash: null });
    expect((await ctx.website.settings.get(spaceId)).password).toBeNull();

    const log = await ctx.audit.list(spaceId, { targetKind: 'website.settings' });
    expect(JSON.stringify(log.items)).not.toContain('argon2');
    const changes = log.items
      .filter((entry) => entry.action === 'website.settings.update')
      .flatMap((entry) => entry.changes)
      .filter((change) => change.path === 'site.password');
    expect(changes).toEqual([
      { path: 'site.password', from: 'set', to: null },
      { path: 'site.password', from: 'set', to: 'changed' },
      { path: 'site.password', from: null, to: 'set' },
    ]);
  });

  it('while the password feature is off, the password stays and cannot be set or removed', async () => {
    const spaceId = await freshSpace();
    await ctx.website.settings.set(spaceId, { mode: 'designed', passwordHash: HASH });
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: spaceId },
      features: { 'plugins.website.password': false },
    });
    try {
      for (const passwordHash of [null, `${HASH}x`]) {
        await expect(ctx.website.settings.set(spaceId, { passwordHash })).rejects.toMatchObject({
          key: 'control.feature',
        });
      }
      // Other site settings still save, and keep the protection.
      await ctx.website.settings.set(spaceId, { localeStrategy: 'domain' });
      expect((await ctx.website.settings.get(spaceId)).password).toBe(HASH);
    } finally {
      await restore();
    }
    await ctx.website.settings.set(spaceId, { passwordHash: null });
    expect((await ctx.website.settings.get(spaceId)).password).toBeNull();
  });
});
