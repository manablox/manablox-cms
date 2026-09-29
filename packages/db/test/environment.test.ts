import { randomUUID } from 'node:crypto';
import type { SpaceScope } from '@manablox/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { TOTAL_PERIOD } from '../src/repositories/limit-count.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('environment');
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
/** A fresh space with a staging environment beside its production one. */
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
  return {
    spaceId: space.id,
    production: production?.id as string,
    staging: { spaceId: space.id, environmentId: staging.id } satisfies SpaceScope,
  };
}

const page = () => ctx.types.page;

describe('environment repository', () => {
  it('gives every new space exactly one production environment', async () => {
    const space = await ctx.repos.spaces.create({
      name: 'Fresh',
      machineName: 'fresh',
      url: 'http://f.test',
    });
    const environments = await ctx.repos.environments.listBySpace(space.id);
    expect(environments).toMatchObject([
      { spaceId: space.id, machineName: 'production', kind: 'production', createdFrom: null },
    ]);
    const [production] = environments;
    expect(await ctx.repos.environments.findById(production?.id as string)).toEqual(production);
    expect(await ctx.repos.environments.findByMachineName(space.id, 'production')).toEqual(
      production,
    );
    expect(await ctx.repos.environments.production(space.id)).toEqual(production);

    const second = await ctx.repos.environments
      .create({ spaceId: space.id, machineName: 'other', name: 'Other', kind: 'production' })
      .catch((error: unknown) => error);
    expect(isUniqueViolation(second, 'production')).toBe(true);
    expect(await ctx.repos.environments.delete(production?.id as string)).toBe(false);
  });

  it('lists production first, then by machine name, and deletes staging with its rows', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    await ctx.repos.environments.create({
      spaceId,
      machineName: 'preview',
      name: 'Preview',
      kind: 'staging',
    });
    const names = (await ctx.repos.environments.listBySpace(spaceId)).map((e) => e.machineName);
    expect(names).toEqual(['production', 'preview', 'staging']);
    const bySpace = await ctx.repos.environments.listBySpaces([spaceId]);
    expect(bySpace.get(spaceId)?.map((e) => e.machineName)).toEqual(names);

    await ctx.repos.menus.create({ ...staging, name: 'Main', machineName: 'main' });
    expect(await ctx.repos.environments.delete(staging.environmentId)).toBe(true);
    expect(await ctx.repos.menus.findByMachineName(staging, 'main')).toBeNull();
  });
});

describe('environment-scoped rows', () => {
  it('keeps unique keys per environment', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    const doc = (scope: SpaceScope | string) =>
      ctx.repos.content.create({
        ...(typeof scope === 'string' ? { spaceId: scope } : scope),
        typeId: page().id,
        locale: 'en',
        title: 'About',
        slug: 'about',
        fields: {},
        hasSlug: true,
      });
    const live = await doc(spaceId);
    const draft = await doc(staging);
    expect(draft.environmentId).toBe(staging.environmentId);
    expect(draft.permalink).toBe(live.permalink);
    const clash = await doc(staging).catch((error: unknown) => error);
    expect(isUniqueViolation(clash, 'sibling_slug')).toBe(true);
    await ctx.repos.content.publish(live.id);
    await ctx.repos.content.publish(draft.id);

    for (const scope of [spaceId, staging]) {
      await ctx.repos.menus.create({
        ...(typeof scope === 'string' ? { spaceId: scope } : scope),
        name: 'Main',
        machineName: 'main',
      });
      // Default type ids derive from space and name, so a second environment names its own.
      await ctx.repos.contentTypes.create(
        { id: randomUUID(), name: `article_${counter}`, spaceId, fields: [] },
        typeof scope === 'string' ? null : scope.environmentId,
      );
      await ctx.repos.redirects.create(scope, {
        locale: null,
        fromPath: '/old',
        toPath: '/about',
        toContentId: null,
        status: 301,
      });
    }
    const menu = await ctx.repos.menus
      .create({ ...staging, name: 'Main', machineName: 'main' })
      .catch((error: unknown) => error);
    expect(isUniqueViolation(menu, 'machine_name')).toBe(true);
  });

  it('never returns staging rows to production reads', async () => {
    const { spaceId, production, staging } = await spaceWithStaging();
    const draft = await ctx.repos.content.create({
      ...staging,
      typeId: page().id,
      locale: 'en',
      title: 'Hidden',
      slug: 'hidden',
      fields: {},
      hasSlug: true,
    });
    await ctx.repos.content.publish(draft.id);
    const type = await ctx.repos.contentTypes.create(
      { id: randomUUID(), name: `staged_${counter}`, spaceId, fields: [] },
      staging.environmentId,
    );
    const menu = await ctx.repos.menus.create({ ...staging, name: 'Main', machineName: 'main' });
    await ctx.repos.menus.setItems(menu.id, [{ localizationId: draft.localizationId }]);
    await ctx.repos.spaceApiHosts.create(staging, { hostname: `api-${counter}.example.test` });
    await ctx.repos.redirects.create(staging, {
      locale: null,
      fromPath: '/old',
      toPath: '/hidden',
      toContentId: null,
      status: 301,
    });
    await ctx.repos.approvals.request({
      spaceId,
      contentId: draft.id,
      typeId: page().id,
      requestedBy: null,
      requestedByLabel: 'Sam',
    });

    const { content } = ctx.repos;
    expect((await content.page({ spaceId }, { limit: 10, offset: 0 })).total).toBe(0);
    expect(
      (await content.page({}, { limit: 100, offset: 0 })).items.map((r) => r.id),
    ).not.toContain(draft.id);
    expect((await content.page({ spaceId }, { limit: 10, offset: 0 }, [], true)).total).toBe(0);
    expect(await content.findByPermalink(spaceId, 'en', 'hidden')).toBeNull();
    expect(await content.findByPermalink(spaceId, 'en', 'hidden', false)).toBeNull();
    expect(await content.listTree(spaceId, 'en')).toEqual([]);
    expect((await content.pageTreeChildren(spaceId, 'en')).total).toBe(0);
    expect(await content.listByIds([draft.id], false, spaceId)).toEqual([]);
    expect(await content.listByLocalizationIds(spaceId, [draft.localizationId])).toEqual([]);
    expect(await content.countSummary(spaceId)).toEqual([]);
    expect((await ctx.repos.contentTypes.list()).map((t) => t.id)).not.toContain(type.id);
    expect(await ctx.repos.menus.listBySpace(spaceId)).toEqual([]);
    expect(await ctx.repos.menus.findByMachineName(spaceId, 'main')).toBeNull();
    expect(await ctx.repos.menus.listByLocalizations(spaceId, draft.localizationId)).toEqual([]);
    expect(await ctx.repos.spaceApiHosts.listBySpace(spaceId)).toEqual([]);
    expect(await ctx.repos.redirects.lookup(spaceId, 'en', '/old')).toBeNull();
    expect((await ctx.repos.redirects.page(spaceId, {}, { limit: 10, offset: 0 })).total).toBe(0);
    expect((await ctx.repos.approvals.pagePendingBySpace(spaceId)).total).toBe(0);

    // The staging scope reads its own rows.
    expect(
      (
        await content.page(
          { spaceId, environmentId: staging.environmentId },
          { limit: 10, offset: 0 },
        )
      ).total,
    ).toBe(1);
    expect((await content.findByPermalink(staging, 'en', 'hidden'))?.id).toBe(draft.id);
    expect((await ctx.repos.menus.resolve(menu, 'en'))[0]?.content?.id).toBe(draft.id);
    expect((await ctx.repos.redirects.lookup(staging, 'en', '/old'))?.toPath).toBe('/hidden');
    expect((await ctx.repos.approvals.pagePendingBySpace(staging)).total).toBe(1);
    expect((await ctx.repos.contentTypes.listByScope(staging)).map((t) => t.id)).toEqual([type.id]);
    expect(production).not.toBe(staging.environmentId);
  });

  it('counts only production rows toward limits', async () => {
    const { spaceId, staging } = await spaceWithStaging();
    const create = (scope: SpaceScope | string, slug: string) =>
      ctx.repos.content.create({
        ...(typeof scope === 'string' ? { spaceId: scope } : scope),
        typeId: page().id,
        locale: 'en',
        title: slug,
        slug,
        fields: {},
        hasSlug: true,
      });
    await create(spaceId, 'live');
    const draft = await create(staging, 'staged');
    await create(staging, 'staged-too');
    for (const scope of [spaceId, staging]) {
      const spread = typeof scope === 'string' ? { spaceId: scope } : scope;
      await ctx.repos.menus.create({ ...spread, name: 'Main', machineName: 'main' });
      await ctx.repos.redirects.create(scope, {
        locale: null,
        fromPath: '/old',
        toPath: '/new',
        toContentId: null,
        status: 301,
      });
    }

    const counts = ctx.repos.limitCounts;
    expect(await counts.menus([spaceId])).toBe(1);
    expect(await counts.manualRedirects([spaceId])).toBe(1);
    const documents = {
      scope: { kind: 'space' as const, id: spaceId },
      metric: 'documents',
      period: TOTAL_PERIOD,
    };
    expect(await ctx.repos.usageCounters.get(documents)).toBe(1);
    expect((await counts.totals()).get(spaceId)?.documents).toBe(1);
    expect((await ctx.repos.spaces.counts([spaceId])).get(spaceId)?.documents).toBe(1);

    await ctx.repos.content.deleteReturning(draft.id);
    expect(await ctx.repos.usageCounters.get(documents)).toBe(1);
  });
});
