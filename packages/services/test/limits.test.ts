import type { ControlScope, LimitKey } from '@manablox/core';
import { ManabloxError } from '@manablox/core';
import { TOTAL_PERIOD } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileTotals } from '../src/controls/counters.js';
import { EnvironmentLifecycleService } from '../src/environments/index.js';
import { createServiceContext, type ServiceContext, spaceGroup } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let environments: EnvironmentLifecycleService;
let seq = 0;

beforeAll(async () => {
  ctx = await createServiceContext('limits', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  environments = new EnvironmentLifecycleService(ctx.manablox, ctx.repos, {
    contentTypes: ctx.contentTypes,
  });
});
afterAll(async () => {
  await ctx?.close();
});

beforeEach(async () => {
  for (const row of await ctx.repos.controlSettings.listAll()) {
    await ctx.repos.controlSettings.delete({ kind: row.scopeKind, id: row.scopeId }, row.key);
  }
  for (const group of await ctx.repos.spaceGroups.list()) {
    await ctx.repos.spaceGroups.delete(group.id);
  }
  ctx.controlStore.forget(null);
});

const next = () => ++seq;

const freshSpace = async () => {
  const name = `lim-${next()}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://l.test' })).id;
};

const user = (name = `u${next()}`) =>
  ctx.repos.users.create({ name, email: `${name}@l.test`, role: 'editor', passwordHash: 'x' });

async function failure(run: Promise<unknown>): Promise<ManabloxError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!ManabloxError.is(error)) throw new Error(`expected a ManabloxError, got ${String(error)}`);
  return error;
}

const setLimit = (scope: ControlScope, key: LimitKey, value: unknown) =>
  ctx.controls.set(scope, `limits.${key}`, value);

/** The count a limit key sees at `scope`, read through a soft limit of 0. */
async function usedAt(scope: ControlScope, key: LimitKey, spaceId: string): Promise<number> {
  await setLimit(scope, key, { max: 0, mode: 'soft' });
  const [breach] = await ctx.controlStore.assertLimit(spaceId, key);
  await ctx.controls.delete(scope, `limits.${key}`);
  return breach?.used ?? 0;
}

const dataTypes = new Map<string, string>();
const localesOf = new Map<string, string[]>();
const LOCALES = ['de', 'fr', 'it', 'es', 'nl', 'pt'];

/** One new thing a key counts, created in `spaceId`. */
const adders: Record<Exclude<LimitKey, 'apiKeys'>, (spaceId: string) => Promise<unknown>> = {
  spaces: () => {
    const name = `made-${next()}`;
    return ctx.spaces.create({ name, machineName: name, url: 'http://m.test' }, null);
  },
  seats: async (spaceId) => ctx.spaces.grant(spaceId, (await user()).id, 'editor'),
  contentTypes: (spaceId) =>
    ctx.contentTypes.create({ name: `type${next()}`, spaceId, fields: [] }),
  documents: (spaceId) =>
    ctx.content.create(
      { spaceId, typeId: ctx.ids.article as string, title: `Doc ${next()}`, fields: {} },
      null,
    ),
  databagTypes: (spaceId) =>
    ctx.contentTypes.create({ name: `bag${next()}`, kind: 'data', spaceId, fields: [] }),
  databagEntries: (spaceId) =>
    ctx.content.create(
      { spaceId, typeId: dataTypes.get(spaceId) as string, title: `Entry ${next()}`, fields: {} },
      null,
    ),
  localesPerSpace: async (spaceId) => {
    const locales = localesOf.get(spaceId) ?? ['en'];
    const added = [...locales, LOCALES[locales.length - 1] as string];
    await ctx.spaces.update(spaceId, { locales: added });
    localesOf.set(spaceId, added);
  },
  menusPerSpace: (spaceId) => {
    const name = `menu${next()}`;
    return ctx.menus.create({ spaceId, name, machineName: name });
  },
  customDomains: (spaceId) => ctx.apiHosts.create(spaceId, `h${next()}.limits.test`),
  redirectsPerSpace: (spaceId) =>
    ctx.redirects.create(spaceId, { fromPath: `/old-${next()}`, toPath: '/new' }),
  customRolesPerSpace: (spaceId) => {
    const name = `role${next()}`;
    return ctx.roles.create(spaceId, { name, machineName: name, permissions: [] });
  },
  // Production is not counted.
  environmentsPerSpace: (spaceId) =>
    environments.create(spaceId, { machineName: `stage${next()}`, name: 'Stage', mode: 'config' }),
  // The upload's check, then its write.
  storageBytes: async (spaceId) => {
    await ctx.manablox.controls.assertLimit(spaceId, 'storageBytes', { increment: 1 });
    return ctx.repos.assets.create({
      spaceId,
      driver: 'local',
      key: `k/${next()}.bin`,
      filename: 'f.bin',
      name: 'f',
      mimeType: 'application/octet-stream',
      size: 1,
    });
  },
};

/** A space ready for every adder. */
async function readySpace(): Promise<string> {
  const spaceId = await freshSpace();
  const bag = await ctx.contentTypes.create({
    name: `entries${next()}`,
    kind: 'data',
    spaceId,
    fields: [],
  });
  dataTypes.set(spaceId, bag.id);
  return spaceId;
}

const PER_SPACE = new Set<LimitKey>([
  'localesPerSpace',
  'menusPerSpace',
  'redirectsPerSpace',
  'customRolesPerSpace',
  'environmentsPerSpace',
]);

type ScopeKind = ControlScope['kind'];
const SCOPES: Record<keyof typeof adders, ScopeKind[]> = {
  spaces: ['instance'],
  // An account is an instance seat when it is created, not when it joins a space.
  seats: ['space', 'group'],
  contentTypes: ['space', 'group', 'instance'],
  documents: ['space', 'group', 'instance'],
  databagTypes: ['space', 'group', 'instance'],
  databagEntries: ['space', 'group', 'instance'],
  localesPerSpace: ['space', 'group', 'instance'],
  menusPerSpace: ['space', 'group', 'instance'],
  customDomains: ['space', 'group', 'instance'],
  redirectsPerSpace: ['space', 'group', 'instance'],
  customRolesPerSpace: ['space', 'group', 'instance'],
  environmentsPerSpace: ['space', 'group', 'instance'],
  storageBytes: ['space', 'group', 'instance'],
};

/** Refuses at the limit through the service's own create path. */
async function refusedThroughService(
  key: keyof typeof adders,
  kind: ScopeKind,
  run: () => Promise<unknown>,
): Promise<void> {
  const error = await failure(run());
  expect(error).toMatchObject({ key: 'control.limit', status: 409 });
  expect(error.details[0]?.params).toMatchObject({ limit: key });
  expect(String(error.details[0]?.params?.scope)).toMatch(
    kind === 'instance' ? /^instance$/ : new RegExp(`^${kind}:`),
  );
}

describe('count limits', () => {
  for (const [key, kinds] of Object.entries(SCOPES) as Array<[keyof typeof adders, ScopeKind[]]>) {
    for (const kind of kinds) {
      it(`${key}: hard at ${kind}, soft passes, off ignored`, async () => {
        const [a, b] = [await readySpace(), await readySpace()];
        const scope: ControlScope =
          kind === 'space'
            ? { kind, id: a }
            : kind === 'group'
              ? await spaceGroup(ctx, [a, b])
              : { kind: 'instance' };
        const add = adders[key];
        const used = await usedAt(scope, key, a);
        // Storage adds one byte per asset.
        await setLimit(scope, key, { max: used + 1 });
        await add(a);
        // The second one breaks the limit; per-space keys count the acting space only.
        const second = kind === 'space' || PER_SPACE.has(key) ? a : b;
        if (kind !== 'space' && PER_SPACE.has(key)) await add(b);
        await refusedThroughService(key, kind, () => add(second));

        await setLimit(scope, key, { max: used + 1, mode: 'soft' });
        await add(second);
        await setLimit(scope, key, { max: used + 1, mode: 'off' });
        await add(second);
      });
    }
  }

  it('checks nothing and counts nothing without a limit', async () => {
    const spaceId = await readySpace();
    const spies = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.repos.limitCounts))
        .filter((name) => name !== 'constructor')
        .map((name) => vi.spyOn(ctx.repos.limitCounts, name as 'spaces')),
      vi.spyOn(ctx.repos.usageCounters, 'sumForSpaces'),
      vi.spyOn(ctx.repos.spaceGroups, 'listSpaceIds'),
    ];
    try {
      for (const add of Object.values(adders)) await add(spaceId);
      await ctx.spaces.addMembers(spaceId, [(await user()).id], 'editor');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('checks a batch of new members at once', async () => {
    const [a, b] = [await freshSpace(), await freshSpace()];
    const group = await spaceGroup(ctx, [a, b]);
    const [one, two, three] = [await user(), await user(), await user()];
    await ctx.spaces.grant(a, one.id, 'editor');

    await setLimit({ kind: 'space', id: b }, 'seats', { max: 2 });
    const refused = await failure(ctx.spaces.addMembers(b, [one.id, two.id, three.id], 'editor'));
    expect(refused.details[0]?.params).toMatchObject({ scope: `space:${b}`, used: 0, max: 2 });
    expect(await ctx.spaces.members(b)).toEqual([]);
    await ctx.spaces.addMembers(b, [one.id, two.id], 'editor');

    // `one` already holds a seat in the group; `three` takes the last one.
    await ctx.controls.delete({ kind: 'space', id: b }, 'limits.seats');
    await setLimit(group, 'seats', { max: 3 });
    await ctx.spaces.addMembers(a, [two.id, three.id], 'editor');
    const full = await failure(ctx.spaces.grant(b, (await user()).id, 'editor'));
    expect(full.details[0]?.params).toMatchObject({ scope: `group:${group.id}`, used: 3 });
  });

  it('blocks only new creation once usage is over a lowered limit', async () => {
    const spaceId = await freshSpace();
    const members = [await user(), await user()];
    await ctx.spaces.addMembers(
      spaceId,
      members.map((member) => member.id),
      'editor',
    );
    await setLimit({ kind: 'space', id: spaceId }, 'seats', { max: 1 });

    // A role change adds no seat.
    await ctx.spaces.grant(spaceId, members[0]?.id as string, 'admin');
    await ctx.spaces.addMembers(spaceId, [members[1]?.id as string], 'editor');
    await failure(ctx.spaces.grant(spaceId, (await user()).id, 'editor'));
    expect(await ctx.spaces.members(spaceId)).toHaveLength(2);
  });

  it('counts a new account against the instance seats', async () => {
    const used = await usedAt({ kind: 'instance' }, 'seats', await freshSpace());
    await setLimit({ kind: 'instance' }, 'seats', { max: used });
    const refused = await failure(ctx.controlStore.assertLimit(null, 'seats'));
    expect(refused.details[0]?.params).toMatchObject({ scope: 'instance', used, max: used });
  });

  it('counts API keys that still work at the instance', async () => {
    const spaceId = await freshSpace();
    const owner = await user();
    const key = (expiresAt: Date | null) =>
      ctx.repos.apiKeys.create({
        userId: owner.id,
        name: 'k',
        prefix: `p${next()}`,
        start: 'mbx',
        key: `digest${next()}`,
        expiresAt,
        spaceIds: null,
        permissions: null,
      });
    const used = await usedAt({ kind: 'instance' }, 'apiKeys', spaceId);
    await key(null);
    await key(new Date(Date.now() + 60_000));
    await key(new Date(Date.now() - 60_000));
    expect(await usedAt({ kind: 'instance' }, 'apiKeys', spaceId)).toBe(used + 2);
  });

  it('checks a content type plan as a whole', async () => {
    const spaceId = await freshSpace();
    await setLimit({ kind: 'space', id: spaceId }, 'contentTypes', { max: 1 });
    const plan = {
      types: [
        { name: 'first', kind: 'content' as const, fields: [] },
        { name: 'second', kind: 'content' as const, fields: [] },
      ],
    };
    const refused = await failure(ctx.contentTypes.applyPlan(spaceId, plan as never));
    expect(refused.details[0]?.params).toMatchObject({ limit: 'contentTypes', used: 0 });
    expect(ctx.contentTypes.list(spaceId).filter((type) => type.spaceId === spaceId)).toEqual([]);
  });
});

describe('total counters', () => {
  const counter = (spaceId: string, metric: string) =>
    ctx.repos.usageCounters.get({
      scope: { kind: 'space', id: spaceId },
      metric,
      period: TOTAL_PERIOD,
    });

  it('counts documents across create, translation and delete, entries apart', async () => {
    const spaceId = await readySpace();
    await ctx.spaces.update(spaceId, { locales: ['en', 'de'] });
    const parent = await adders.documents(spaceId);
    const parentId = (parent as { id: string }).id;
    await ctx.content.create(
      { spaceId, typeId: ctx.ids.article as string, parentId, title: 'Child', fields: {} },
      null,
    );
    await ctx.content.createTranslation(spaceId, parentId, 'de', null);
    await adders.databagEntries(spaceId);
    expect(await counter(spaceId, 'documents')).toBe(3);
    expect(await counter(spaceId, 'databagEntries')).toBe(1);

    await ctx.content.delete(spaceId, parentId, null, 'cascade');
    expect(await counter(spaceId, 'documents')).toBe(1);
  });

  it('counts stored bytes across upload, variants, space moves and delete', async () => {
    const [a, b] = [await freshSpace(), await freshSpace()];
    const asset = await ctx.repos.assets.create({
      spaceId: a,
      driver: 'local',
      key: `k/${next()}.jpg`,
      filename: 'p.jpg',
      name: 'p',
      mimeType: 'image/jpeg',
      size: 100,
    });
    const variant = { assetId: asset.id, preset: 'thumb', format: 'webp', key: 'v/1' };
    await ctx.repos.assets.upsertVariant({ ...variant, size: 20 });
    await ctx.repos.assets.upsertVariant({ ...variant, size: 30 });
    await ctx.repos.assets.upsertVariant({ ...variant, format: 'avif', key: 'v/2', size: 5 });
    expect(await counter(a, 'storageBytes')).toBe(135);

    // Shared, it still counts where it was uploaded.
    await ctx.repos.assets.addToSpace(asset.id, b);
    expect([await counter(a, 'storageBytes'), await counter(b, 'storageBytes')]).toEqual([135, 0]);
    await ctx.repos.assets.removeFromSpace(asset.id, a);
    expect([await counter(a, 'storageBytes'), await counter(b, 'storageBytes')]).toEqual([0, 135]);

    await ctx.repos.assets.deleteVariantsByAsset(asset.id);
    expect(await counter(b, 'storageBytes')).toBe(100);
    await ctx.repos.assets.delete(asset.id);
    expect(await counter(b, 'storageBytes')).toBe(0);
  });

  it('reconciles drifted counters with the rows', async () => {
    const spaceId = await readySpace();
    await adders.documents(spaceId);
    const asset = (await adders.storageBytes(spaceId)) as { id: string };
    await ctx.repos.assets.upsertVariant({
      assetId: asset.id,
      preset: 'thumb',
      format: 'webp',
      key: `v/${next()}`,
      size: 4,
    });
    const key = (metric: string) => ({
      scope: { kind: 'space', id: spaceId } as const,
      metric,
      period: TOTAL_PERIOD,
    });
    await ctx.repos.usageCounters.set(key('documents'), 40);
    await ctx.repos.usageCounters.set(key('storageBytes'), 0);

    expect(await reconcileTotals(ctx.repos)).toBeGreaterThanOrEqual(2);
    expect(await counter(spaceId, 'documents')).toBe(1);
    expect(await counter(spaceId, 'storageBytes')).toBe(5);
    expect(await reconcileTotals(ctx.repos)).toBe(0);
  });
});

describe('space import', () => {
  it('refuses an import over a limit before writing anything', async () => {
    const source = await readySpace();
    for (let index = 0; index < 3; index++) await adders.documents(source);
    const payload = await ctx.spaces.export(source);
    const copy = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: 'imported', name: 'I' },
    };
    const owner = await user();
    const spacesBefore = (await ctx.repos.spaces.list()).length;

    const used = await usedAt({ kind: 'instance' }, 'documents', source);
    await setLimit({ kind: 'instance' }, 'documents', { max: used + 2 });
    const refused = await failure(ctx.spaces.import(copy, owner.id));
    expect(refused.details[0]?.params).toMatchObject({ limit: 'documents', scope: 'instance' });
    expect((await ctx.repos.spaces.list()).length).toBe(spacesBefore);

    await ctx.controls.delete({ kind: 'instance' }, 'limits.documents');
    await setLimit({ kind: 'instance' }, 'spaces', { max: spacesBefore });
    const spaces = await failure(ctx.spaces.import(copy, owner.id));
    expect(spaces.details[0]?.params).toMatchObject({ limit: 'spaces', used: spacesBefore });
    expect((await ctx.repos.spaces.list()).length).toBe(spacesBefore);
  });
});
