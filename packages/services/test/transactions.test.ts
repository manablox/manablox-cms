import { type ContentTypePlan, FOLDER_TYPE_NAME } from '@manablox/core';
import { runAsActor } from '@manablox/core/node';
import { inTransaction, type UserRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { onWrite } from '../src/content/listeners.js';
import { applySpaceStarter } from '../src/space-starter.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let owner: UserRow;

/** Side-effect hooks fired, in order. */
const fired: string[] = [];
const WATCHED = [
  'content:afterCreate',
  'content:afterUpdate',
  'content:afterDelete',
  'content:afterDeleteMany',
  'content:afterPublish',
  'menu:afterWrite',
  'contentType:afterCreate',
  'member:afterGrant',
  'cache:purge',
] as const;

beforeAll(async () => {
  ctx = await createServiceContext('transactions', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      ...TEST_TYPES,
      { name: 'post', requiresApproval: true, fields: [{ name: 'body', type: 'string' }] },
    ],
  });
  await ctx.repos.spaces.update(ctx.spaceId, { locales: ['en', 'de'] });
  owner = await ctx.repos.users.create({
    name: 'Owner',
    email: 'owner@example.com',
    role: 'superadmin',
    passwordHash: 'x',
  });
  await ctx.repos.users.grant(owner.id, ctx.spaceId, 'owner');
  for (const hook of WATCHED) {
    ctx.manablox.hooks.on(hook, () => {
      fired.push(hook);
    });
  }
});
afterAll(async () => {
  await ctx?.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Fails the `call`-th call of a repository method on every instance, transaction-bound ones
 * included; the others run as usual.
 */
function failOn<T extends object>(repository: T, method: keyof T & string, call = 1) {
  type Method = (...args: unknown[]) => unknown;
  const prototype = Object.getPrototypeOf(repository) as Record<string, Method>;
  const original = prototype[method] as Method;
  let calls = 0;
  return vi.spyOn(prototype, method).mockImplementation(function (this: unknown, ...args) {
    calls += 1;
    if (calls === call) return Promise.reject(new Error('injected'));
    return original.apply(this, args);
  });
}

/** Runs `fn` and returns the hooks it fired. */
async function effects(fn: () => Promise<unknown>): Promise<string[]> {
  fired.length = 0;
  await fn();
  return [...fired];
}

/** Runs `fn`, expects the injected failure, and returns the hooks it fired. */
async function failing(fn: () => Promise<unknown>): Promise<string[]> {
  fired.length = 0;
  await expect(fn()).rejects.toThrow('injected');
  return [...fired];
}

const count = (hooks: string[], hook: (typeof WATCHED)[number]) =>
  hooks.filter((entry) => entry === hook).length;

const documents = async () =>
  (await ctx.repos.content.page({ spaceId: ctx.spaceId }, { limit: 1, offset: 0 })).total;

const audits = () => ctx.repos.audit.count({});

const article = (title: string, over: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title,
    fields: {},
    ...over,
  });

describe('content', () => {
  it('duplicates a subtree all or nothing, with hooks after commit', async () => {
    const root = await article('Root');
    const child = await article('Child', { parentId: root.id });
    await article('Grandchild', { parentId: child.id });
    await article('Second child', { parentId: root.id, position: 1 });
    const [rows, entries] = [await documents(), await audits()];

    failOn(ctx.repos.content, 'create', 3);
    const failed = await failing(() =>
      ctx.content.duplicate(ctx.spaceId, root.id, null, { children: true }),
    );
    expect(failed).toEqual([]);
    expect(await documents()).toBe(rows);
    expect(await audits()).toBe(entries);
    vi.restoreAllMocks();

    const done = await effects(() =>
      ctx.content.duplicate(ctx.spaceId, root.id, null, { children: true }),
    );
    expect(count(done, 'content:afterCreate')).toBe(4);
    expect(await documents()).toBe(rows + 4);
  });

  it('creates a folder in every locale or in none', async () => {
    const rows = await documents();
    failOn(ctx.repos.content, 'create', 2);
    expect(
      await failing(() => ctx.content.createFolder(ctx.spaceId, { title: 'Box', locale: 'en' })),
    ).toEqual([]);
    expect(await documents()).toBe(rows);
    vi.restoreAllMocks();

    const done = await effects(() =>
      ctx.content.createFolder(ctx.spaceId, { title: 'Box', locale: 'en' }),
    );
    expect(count(done, 'content:afterCreate')).toBe(2);
    expect(ctx.manablox.contentTypes.getByName(FOLDER_TYPE_NAME)).toBeTruthy();
  });

  it('keeps a subtree when its delete fails, and purges once when it succeeds', async () => {
    const root = await article('Doomed');
    await article('Doomed child', { parentId: root.id });
    const rows = await documents();

    failOn(ctx.repos.audit, 'recordMany');
    expect(await failing(() => ctx.content.delete(ctx.spaceId, root.id))).toEqual([]);
    expect(await documents()).toBe(rows);
    vi.restoreAllMocks();

    const done = await effects(() => ctx.content.delete(ctx.spaceId, root.id));
    expect(count(done, 'content:afterDelete')).toBe(2);
    expect(count(done, 'content:afterDeleteMany')).toBe(1);
    expect(count(done, 'cache:purge')).toBe(1);
    expect(await documents()).toBe(rows - 2);
  });

  it('moves back when the audit entry fails', async () => {
    const parent = await article('Parent');
    const row = await article('Mover');

    failOn(ctx.repos.audit, 'record');
    await failing(() => ctx.content.move(ctx.spaceId, row.id, parent.id, 0));
    expect((await ctx.repos.content.findById(row.id))?.parentId).toBeNull();
    vi.restoreAllMocks();

    await ctx.content.move(ctx.spaceId, row.id, parent.id, 0);
    expect((await ctx.repos.content.findById(row.id))?.parentId).toBe(parent.id);
  });

  it('writes a translation and its shared fields together', async () => {
    const source = await article('Shared', { fields: { body: '<p>en</p>' } });
    const rows = await documents();

    failOn(ctx.repos.content, 'patchFields');
    expect(
      await failing(() => ctx.content.createTranslation(ctx.spaceId, source.id, 'de')),
    ).toEqual([]);
    expect(await documents()).toBe(rows);
    expect(await ctx.content.translations(ctx.spaceId, source.id)).toHaveLength(1);
    vi.restoreAllMocks();

    const done = await effects(() => ctx.content.createTranslation(ctx.spaceId, source.id, 'de'));
    expect(count(done, 'content:afterCreate')).toBe(1);
    expect(await ctx.content.translations(ctx.spaceId, source.id)).toHaveLength(2);
  });
});

describe('menus', () => {
  it('places a document in every menu or in none', async () => {
    const row = await article('Placed');
    const main = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'M', machineName: 'm1' });
    const foot = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'F', machineName: 'f1' });
    const spots = [
      { menuId: main.id, parentId: null, index: 0 },
      { menuId: foot.id, parentId: null, index: 0 },
    ];

    failOn(ctx.repos.menus, 'setItems', 2);
    expect(
      await failing(() => ctx.menus.setPlacements(ctx.spaceId, row.localizationId, spots)),
    ).toEqual([]);
    expect(await ctx.repos.menus.listItemTree(main.id)).toEqual([]);
    vi.restoreAllMocks();

    const done = await effects(() =>
      ctx.menus.setPlacements(ctx.spaceId, row.localizationId, spots),
    );
    expect(count(done, 'menu:afterWrite')).toBe(2);
    expect(await ctx.repos.menus.listItemTree(main.id)).toHaveLength(1);
    expect(await ctx.repos.menus.listItemTree(foot.id)).toHaveLength(1);
  });
});

describe('members and roles', () => {
  const user = (name: string) =>
    ctx.repos.users.create({
      name,
      email: `${name}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });

  it('adds members all or none, and notifies each like a grant', async () => {
    const [a, b] = [await user('member-a'), await user('member-b')];

    failOn(ctx.repos.users, 'grant', 2);
    expect(await failing(() => ctx.spaces.addMembers(ctx.spaceId, [a.id, b.id], 'editor'))).toEqual(
      [],
    );
    expect(await ctx.repos.users.findSpaceRole(a.id, ctx.spaceId)).toBeNull();
    vi.restoreAllMocks();

    const done = await effects(() => ctx.spaces.addMembers(ctx.spaceId, [a.id, b.id], 'editor'));
    expect(count(done, 'member:afterGrant')).toBe(2);
    await ctx.notifications.settle();
    const kinds = { kinds: ['member.granted' as const] };
    expect((await ctx.notifications.list(a.id, kinds)).items).toHaveLength(1);
    expect((await ctx.notifications.list(b.id, kinds)).items).toHaveLength(1);
  });

  it('keeps the role when a grant cannot be audited', async () => {
    const c = await user('member-c');
    await ctx.spaces.grant(ctx.spaceId, c.id, 'viewer');

    failOn(ctx.repos.audit, 'record');
    expect(await failing(() => ctx.spaces.grant(ctx.spaceId, c.id, 'editor'))).toEqual([]);
    expect(await ctx.repos.users.findSpaceRole(c.id, ctx.spaceId)).toBe('viewer');
  });

  it('keeps a role when its delete cannot be audited', async () => {
    const role = await ctx.roles.create(ctx.spaceId, {
      name: 'Temp',
      machineName: 'temp',
      permissions: [],
    });
    failOn(ctx.repos.audit, 'record');
    await failing(() => ctx.roles.delete(ctx.spaceId, role.id as string));
    expect(await ctx.repos.roles.findById(role.id as string)).not.toBeNull();
  });
});

describe('content types', () => {
  const plan: ContentTypePlan = {
    types: [
      {
        name: 'plan_page',
        kind: 'content',
        fields: [{ name: 'parts', type: 'blocks', settings: { types: ['plan_part'] } }],
      },
      { name: 'plan_part', kind: 'block', fields: [{ name: 'text', type: 'string' }] },
    ],
  };

  it('applies a plan all or nothing, loading the registry once committed', async () => {
    const before = ctx.contentTypes.list(ctx.spaceId).length;
    failOn(ctx.repos.contentTypes, 'create', 2);
    expect(await failing(() => ctx.contentTypes.applyPlan(ctx.spaceId, plan))).toEqual([]);
    expect(ctx.contentTypes.list(ctx.spaceId)).toHaveLength(before);
    expect((await ctx.repos.contentTypes.list()).map((type) => type.name)).not.toContain(
      'plan_part',
    );
    vi.restoreAllMocks();

    const done = await effects(() => ctx.contentTypes.applyPlan(ctx.spaceId, plan));
    expect(count(done, 'contentType:afterCreate')).toBe(2);
    expect(ctx.contentTypes.list(ctx.spaceId)).toHaveLength(before + 2);
  });
});

describe('tags', () => {
  it('merges tags all or nothing', async () => {
    const row = await article('Tagged');
    const [source] = await ctx.tags.setForContent(ctx.spaceId, row.localizationId, ['old']);
    const [target] = await ctx.tags.ensure(ctx.spaceId, ['new']);

    failOn(ctx.repos.audit, 'record');
    expect(
      await failing(() => ctx.tags.merge(ctx.spaceId, source?.id as string, target?.id as string)),
    ).toEqual([]);
    const tags = await ctx.tags.ofContent([row.localizationId]);
    expect(tags.get(row.localizationId)?.map((tag) => tag.slug)).toEqual(['old']);
    vi.restoreAllMocks();

    const done = await effects(() =>
      ctx.tags.merge(ctx.spaceId, source?.id as string, target?.id as string),
    );
    expect(count(done, 'cache:purge')).toBe(1);
    const merged = await ctx.tags.ofContent([row.localizationId]);
    expect(merged.get(row.localizationId)?.map((tag) => tag.slug)).toEqual(['new']);
  });

  it('creates no tags when assigning them fails', async () => {
    const row = await article('Tag target');
    failOn(ctx.repos.tags, 'setForLocalization');
    expect(
      await failing(() => ctx.tags.setForContent(ctx.spaceId, row.localizationId, ['fresh'])),
    ).toEqual([]);
    expect((await ctx.tags.list(ctx.spaceId)).map((tag) => tag.slug)).not.toContain('fresh');
  });
});

describe('approvals', () => {
  it('leaves the request open when the publish fails', async () => {
    const row = await ctx.content.create(
      {
        spaceId: ctx.spaceId,
        typeId: ctx.ids.post as string,
        locale: 'en',
        title: 'P',
        fields: {},
      },
      { userId: owner.id, roles: ['owner'] },
    );
    const actor = { userId: owner.id, roles: ['owner'] };
    const as = { kind: 'user' as const, id: owner.id, label: owner.email };
    await runAsActor(as, () => ctx.approvals.request(ctx.spaceId, row.id, actor));

    failOn(ctx.repos.content, 'publish');
    expect(
      await failing(() => runAsActor(as, () => ctx.approvals.approve(ctx.spaceId, row.id, actor))),
    ).toEqual([]);
    expect(await ctx.repos.approvals.findPendingByContent(row.id)).not.toBeNull();
    vi.restoreAllMocks();

    const done = await effects(() =>
      runAsActor(as, () => ctx.approvals.approve(ctx.spaceId, row.id, actor)),
    );
    expect(count(done, 'content:afterPublish')).toBe(1);
    expect(await ctx.repos.approvals.findPendingByContent(row.id)).toBeNull();
  });
});

describe('spaces', () => {
  /** No code types claiming the starter's names. */
  let bare: ServiceContext;
  beforeAll(async () => {
    bare = await createServiceContext('transactions_space', {
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
    });
    for (const hook of WATCHED) {
      bare.manablox.hooks.on(hook, () => {
        fired.push(hook);
      });
    }
  });
  afterAll(async () => {
    await bare?.close();
  });

  const input = (machineName: string) => ({
    name: machineName,
    machineName,
    url: `https://${machineName}.example.com`,
  });
  const fill = (space: Parameters<typeof applySpaceStarter>[1], repos: ServiceContext['repos']) =>
    applySpaceStarter({ ...bare, repos }, space, { userId: owner.id, roles: ['superadmin'] });
  const everything = async () => (await bare.repos.content.page({}, { limit: 1, offset: 0 })).total;

  it('leaves no space, types or documents when the starter fails', async () => {
    const types = bare.manablox.contentTypes.all.length;
    const audited = await bare.repos.audit.count({});
    failOn(bare.repos.menus, 'setItems');
    expect(await failing(() => bare.spaces.create(input('broken'), null, fill))).toEqual([]);
    expect(await bare.repos.spaces.findByMachineName('broken')).toBeNull();
    expect(bare.manablox.contentTypes.all).toHaveLength(types);
    expect(await bare.repos.contentTypes.list()).toEqual([]);
    expect(await everything()).toBe(0);
    expect(await bare.repos.audit.count({})).toBe(audited);
    vi.restoreAllMocks();

    const done = await effects(() => bare.spaces.create(input('starter'), null, fill));
    expect(count(done, 'content:afterCreate')).toBe(4);
    expect(count(done, 'content:afterPublish')).toBe(4);
    expect(count(done, 'contentType:afterCreate')).toBe(3);
    expect(count(done, 'menu:afterWrite')).toBe(2);
    expect(await everything()).toBe(4);
    expect(bare.manablox.contentTypes.all).toHaveLength(types + 3);
  });
});

describe('space settings', () => {
  it('keeps the space when its update or asset settings cannot be audited', async () => {
    const before = await ctx.repos.spaces.findById(ctx.spaceId);
    failOn(ctx.repos.audit, 'record');
    await failing(() => ctx.spaces.update(ctx.spaceId, { name: 'Renamed' }));
    vi.restoreAllMocks();
    failOn(ctx.repos.audit, 'record');
    await failing(() => ctx.spaces.setAssetSettings(ctx.spaceId, { maxFileSize: 1024 }));
    vi.restoreAllMocks();

    const after = await ctx.repos.spaces.findById(ctx.spaceId);
    expect(after?.name).toBe(before?.name);
    expect(after?.settings.assets).toEqual(before?.settings.assets);
  });
});

describe('hook services', () => {
  it('lets a before hook inside a subtree copy write through the context services', async () => {
    const root = await article('Noted root');
    await article('Noted child', { parentId: root.id });
    const seen: boolean[] = [];
    const off = ctx.manablox.hooks.on('content:beforeCreate', async (input, context) => {
      if (input.title !== 'Noted child' || !context.services) return input;
      seen.push(inTransaction(context.services.repos));
      await context.services.content.create({
        spaceId: input.spaceId,
        typeId: ctx.ids.article as string,
        locale: 'en',
        title: 'Copy note',
        fields: {},
      });
      return input;
    });
    const committed: boolean[] = [];
    const offAfter = ctx.manablox.hooks.on('content:afterCreate', (_row, context) => {
      if (context.services) committed.push(inTransaction(context.services.repos));
    });
    const notes = async () =>
      (
        await ctx.repos.content.page({ spaceId: ctx.spaceId }, { limit: 500, offset: 0 })
      ).items.filter((row) => row.title === 'Copy note').length;
    try {
      failOn(ctx.repos.audit, 'record', 3);
      await failing(() => ctx.content.duplicate(ctx.spaceId, root.id, null, { children: true }));
      // The note rolled back with the copy.
      expect(await notes()).toBe(0);
      vi.restoreAllMocks();

      await ctx.content.duplicate(ctx.spaceId, root.id, null, { children: true });
      expect(await notes()).toBe(1);
      expect(seen).toEqual([true, true]);
      expect(committed.length).toBeGreaterThan(0);
      expect(committed.every((bound) => !bound)).toBe(true);
    } finally {
      off();
      offAfter();
    }
  });

  it('gives a before hook outside a transaction the root services', async () => {
    const seen: boolean[] = [];
    const off = ctx.manablox.hooks.on('content:beforeCreate', (input, context) => {
      if (context.services) seen.push(inTransaction(context.services.repos));
      return input;
    });
    try {
      await article('Plain');
    } finally {
      off();
    }
    expect(seen).toEqual([false]);
  });
});

describe('built-in listeners', () => {
  it('rolls a delete back when its cleanup fails', async () => {
    const row = await article('Home');
    await ctx.spaces.setHome(ctx.spaceId, row.id);
    const rows = await documents();
    const off = onWrite(ctx.manablox, 'content:afterDeleteMany', () => {
      throw new Error('injected');
    });
    try {
      expect(await failing(() => ctx.content.delete(ctx.spaceId, row.id))).toEqual([]);
    } finally {
      off();
    }
    expect(await documents()).toBe(rows);
    expect((await ctx.repos.spaces.findById(ctx.spaceId))?.settings.homeContentId).toBe(row.id);
  });

  it('commits the cleanup with the delete, before plugin hooks run', async () => {
    const row = await article('Next home');
    await ctx.spaces.setHome(ctx.spaceId, row.id);
    const main = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'L', machineName: 'l1' });
    await ctx.menus.setPlacements(ctx.spaceId, row.localizationId, [
      { menuId: main.id, parentId: null, index: 0 },
    ]);
    await ctx.tags.setForContent(ctx.spaceId, row.localizationId, ['gone']);

    const seen: unknown[] = [];
    const off = ctx.manablox.hooks.on('content:afterDeleteMany', async () => {
      // Root repositories: the delete and its cleanup are committed.
      seen.push(
        (await ctx.repos.content.findById(row.id)) === null,
        (await ctx.repos.spaces.findById(ctx.spaceId))?.settings.homeContentId ?? null,
        (await ctx.repos.menus.listItemTree(main.id)).length,
        (await ctx.tags.ofContent([row.localizationId])).get(row.localizationId) ?? [],
      );
    });
    try {
      await ctx.content.delete(ctx.spaceId, row.id);
    } finally {
      off();
    }
    expect(seen).toEqual([true, null, 0, []]);
  });

  it('keeps the approval open when closing it fails', async () => {
    const row = await ctx.content.create(
      {
        spaceId: ctx.spaceId,
        typeId: ctx.ids.post as string,
        locale: 'en',
        title: 'Q',
        fields: {},
      },
      { userId: owner.id, roles: ['owner'] },
    );
    const actor = { userId: owner.id, roles: ['owner'] };
    const as = { kind: 'user' as const, id: owner.id, label: owner.email };
    await runAsActor(as, () => ctx.approvals.request(ctx.spaceId, row.id, actor));

    failOn(ctx.repos.approvals, 'decide');
    await failing(() => runAsActor(as, () => ctx.content.publish(ctx.spaceId, row.id, actor)));
    expect((await ctx.repos.content.findById(row.id))?.status).not.toBe('published');
    expect(await ctx.repos.approvals.findPendingByContent(row.id)).not.toBeNull();
  });
});
