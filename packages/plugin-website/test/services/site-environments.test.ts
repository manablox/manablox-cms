import { randomUUID } from 'node:crypto';
import { builtinFieldTypes } from '@manablox/fields';
import {
  EnvironmentLifecycleService,
  SnapshotService,
  SpaceTransferService,
} from '@manablox/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;
let environments: EnvironmentLifecycleService;
let counter = 0;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_environments', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  const transfer = new SpaceTransferService(ctx.manablox, ctx.repos, null);
  environments = new EnvironmentLifecycleService(ctx.manablox, ctx.repos, {
    contentTypes: ctx.contentTypes,
    snapshots: new SnapshotService(ctx.manablox, ctx.repos, ctx.spaces, transfer, null as never, {
      controlStore: ctx.controlStore,
    }),
    promotes: ctx.controlStore.promotes,
  });
});
afterAll(async () => {
  await ctx?.close();
});

/** A space with a page type, a design keyed by it, a domain and a 404 page. */
async function freshSpace() {
  const machineName = `site-env-${++counter}-${randomUUID().slice(0, 6)}`;
  const { id: spaceId } = await ctx.spaces.create(
    { name: machineName, machineName, url: 'http://env.test' },
    null,
  );
  const page = await ctx.contentTypes.create({ name: 'page', spaceId, fields: [] });
  const missing = await ctx.content.create({
    spaceId,
    typeId: page.id,
    locale: 'en',
    title: 'Not found',
    slug: 'not-found',
    fields: {},
  });
  const { designs, domains } = websiteRepos(ctx.repos);
  await designs.create({ spaceId, kind: 'block', key: page.id, name: 'Page', draft: {} });
  await domains.create(spaceId, {
    hostname: `${machineName}.example.test`,
    locale: null,
    isPrimary: true,
    redirectToPrimary: false,
  });
  await ctx.website.settings.set(spaceId, { mode: 'designed', notFoundContentId: missing.id });
  return { spaceId, page, missing };
}

describe('website data in environments', () => {
  it('copies designs under the copied type, leaving domains with production', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const scope = { spaceId: seed.spaceId, environmentId: environment.id };
    const [type] = await ctx.repos.environmentRows.list('contentTypes', environment.id);
    const { designs, domains } = websiteRepos(ctx.repos);
    expect((await designs.listByEnvironment(environment.id)).map((row) => row.key)).toEqual([
      type?.id,
    ]);
    expect(await domains.listBySpace(scope)).toEqual([]);
    expect(await domains.listBySpace(seed.spaceId)).toHaveLength(1);
    // The space's settings are shared; a config copy names no 404 page of its own.
    expect(
      await ctx.website.settings.get({ ...scope, machineName: 'staging', production: false }),
    ).toMatchObject({ mode: 'designed', notFoundContentId: null });

    const result = await environments.promote(seed.spaceId, 'staging', 'config');
    expect(result.groups.map((group) => group.group)).toContain('designs');
  });

  it('carries the 404 page through a full copy and a full promote, and drops it with staging', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    const staging = {
      spaceId: seed.spaceId,
      environmentId: environment.id,
      machineName: 'staging',
      production: false,
    };
    const copy = (await ctx.repos.environmentRows.list('contents', environment.id))[0];
    expect((await ctx.website.settings.get(staging)).notFoundContentId).toBe(copy?.id);

    // Staging names none; a full promote then clears production's.
    await ctx.website.settings.set(staging, { notFoundContentId: null });
    expect((await ctx.website.settings.get(seed.spaceId)).notFoundContentId).toBe(seed.missing.id);
    await environments.promote(seed.spaceId, 'staging', 'config');
    expect((await ctx.website.settings.get(seed.spaceId)).notFoundContentId).toBe(seed.missing.id);
    await ctx.website.settings.set(staging, { notFoundContentId: copy?.id as string });
    await environments.promote(seed.spaceId, 'staging', 'full', { confirm: true });
    expect((await ctx.website.settings.get(seed.spaceId)).notFoundContentId).toBe(seed.missing.id);

    await environments.delete(seed.spaceId, 'staging');
    expect(await ctx.repos.pluginSettings.get(staging, 'website')).toBeNull();
    expect((await ctx.website.settings.get(seed.spaceId)).mode).toBe('designed');
  });

  it('clears a deleted 404 page in every environment', async () => {
    const seed = await freshSpace();
    await ctx.content.delete(seed.spaceId, seed.missing.id);
    expect((await ctx.website.settings.get(seed.spaceId)).notFoundContentId).toBeNull();
  });
});
