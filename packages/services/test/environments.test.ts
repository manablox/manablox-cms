import { randomUUID } from 'node:crypto';
import {
  contentTypeId,
  definePlugin,
  HOME_NOMINATION,
  ManabloxError,
  nominationOf,
  permissionsFor,
  TEMPLATE_TYPE_NAME,
} from '@manablox/core';
import { EnvironmentRowsRepository, type SpaceEnvironmentRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachAssetUsages } from '../src/asset-usages.js';
import { PromoteLocks } from '../src/controls/promote-lock.js';
import { defineDataProvider } from '../src/data/provider.js';
import { EnvironmentLifecycleService } from '../src/environments/lifecycle.js';
import { createLoaders } from '../src/loaders.js';
import { SnapshotService } from '../src/snapshots/service.js';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import { SpaceTransferService } from '../src/transfer/service.js';
import { memoryStorage } from './helpers/storage.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let environments: EnvironmentLifecycleService;
let snapshots: SnapshotService;
let counter = 0;
const storage = memoryStorage();

/** A row of the test provider: a note that may point at a menu. */
interface NoteRow {
  id: string;
  spaceId: string;
  environmentId: string;
  name: string;
  enabled: boolean;
  source: 'runtime' | 'code';
  menuId: string | null;
}

/** The provider's store, in memory. */
const notes = new Map<string, NoteRow>();

/**
 * A plugin whose data provider moves notes through copies and promotes: copies arrive switched
 * off, production keeps its switch, and notes from code are neither promoted nor removed.
 */
const notesPlugin = definePlugin({
  name: 'notes',
  data: [
    defineDataProvider<NoteRow, never>({
      kind: 'notes.notes',
      environments: {
        key: 'notes',
        load: async ({ environmentId }) =>
          [...notes.values()]
            .filter((row) => row.environmentId === environmentId)
            .map((row) => ({ ...row })),
        keep: (row) => row.source === 'code',
        promotes: (row) => row.source !== 'code',
        describe: (row) => ({ label: row.name, value: { name: row.name, menu: row.menuId } }),
        async copy({ rows }) {
          for (const row of rows) notes.set(row.id, { ...row, enabled: false });
        },
        async promote({ upsert, remove }) {
          for (const row of remove) notes.delete(row.id);
          for (const row of upsert) {
            notes.set(row.id, { ...row, enabled: notes.get(row.id)?.enabled ?? false });
          }
        },
      },
    }),
  ],
});

beforeAll(async () => {
  ctx = await createServiceContext('environments', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    storage,
    config: { plugins: [notesPlugin] },
  });
  attachAssetUsages(ctx.manablox, ctx.content);
  snapshots = new SnapshotService(
    ctx.manablox,
    ctx.repos,
    ctx.spaces,
    new SpaceTransferService(ctx.manablox, ctx.repos, storage),
    storage,
    { controlStore: ctx.controlStore },
  );
  environments = new EnvironmentLifecycleService(ctx.manablox, ctx.repos, {
    contentTypes: ctx.contentTypes,
    snapshots,
    promotes: ctx.controlStore.promotes,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const name = () => `env-${++counter}-${randomUUID().slice(0, 6)}`;

const keyOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (ManabloxError.is(error)) return error.key;
    throw error;
  }
  throw new Error('expected a failure');
};

const rowsOf = (environment: Pick<SpaceEnvironmentRow, 'id'>) => ({
  types: () => ctx.repos.environmentRows.list('contentTypes', environment.id),
  contents: () => ctx.repos.environmentRows.list('contents', environment.id),
  published: () => ctx.repos.environmentRows.list('publishedContents', environment.id),
  menus: () => ctx.repos.environmentRows.list('menus', environment.id),
  notes: async () => [...notes.values()].filter((row) => row.environmentId === environment.id),
  redirects: () => ctx.repos.environmentRows.list('redirects', environment.id),
  tags: () => ctx.repos.environmentRows.list('contentTags', environment.id),
  usages: () => ctx.repos.environmentRows.list('assetUsages', environment.id),
});

const eventTypes = async (spaceId: string) =>
  (await ctx.repos.controlEvents.listAfter(0, 10_000))
    .filter((row) => row.payload?.spaceId === spaceId)
    .map((row) => row.type);

const auditActions = async (spaceId: string) =>
  (await ctx.repos.audit.page({ spaceId }, undefined, { limit: 200, offset: 0 })).items.map(
    (entry) => entry.action,
  );

/** A space with one of everything an environment holds, all in production. */
async function freshSpace() {
  const machineName = name();
  const space = await ctx.spaces.create(
    { name: machineName, machineName, url: 'http://env.test' },
    null,
  );
  const spaceId = space.id;
  const production = await ctx.repos.environments.production(spaceId);
  if (!production) throw new Error('no production');

  const page = await ctx.contentTypes.create({
    name: 'page',
    spaceId,
    fields: [
      { name: 'summary', type: 'string' },
      { name: 'rating', type: 'string' },
    ],
  });
  const asset = await ctx.repos.assets.create({
    spaceId,
    driver: 'local',
    key: `${spaceId}/hero.jpg`,
    filename: 'hero.jpg',
    name: 'Hero',
    mimeType: 'image/jpeg',
    size: 5,
  });
  const parent = await ctx.content.create({
    spaceId,
    typeId: page.id,
    locale: 'en',
    title: 'About',
    slug: 'about',
    fields: { summary: 'kept', rating: 'five' },
  });
  const child = await ctx.content.create({
    spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: 'Team',
    slug: 'team',
    parentId: parent.id,
    fields: { hero: asset.id },
  });
  await ctx.content.publish(spaceId, parent.id);
  await ctx.content.publish(spaceId, child.id);
  const templateType = ctx.manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME);
  const template = await ctx.content.create({
    spaceId,
    typeId: templateType.id,
    locale: 'en',
    title: 'Hero template',
    fields: {},
  });
  const [tag] = await ctx.repos.tags.ensure(spaceId, [{ name: 'News', slug: 'news' }]);
  await ctx.repos.tags.setForLocalization(spaceId, child.localizationId, [tag?.id as string]);
  const menu = await ctx.repos.menus.create({ spaceId, name: 'Main', machineName: 'main' });
  await ctx.repos.menus.setItems(menu.id, [{ localizationId: parent.localizationId }]);
  await ctx.repos.redirects.create(spaceId, {
    locale: null,
    fromPath: '/old',
    toPath: '/new',
    toContentId: null,
    status: 301,
  });
  await ctx.repos.redirects.create(spaceId, {
    locale: null,
    fromPath: '/about-us',
    toPath: null,
    toContentId: parent.localizationId,
    status: 301,
  });
  const note: NoteRow = {
    id: randomUUID(),
    spaceId,
    environmentId: production.id,
    name: 'Notify',
    enabled: true,
    source: 'runtime',
    menuId: null,
  };
  notes.set(note.id, note);
  await ctx.repos.spaceApiHosts.create(spaceId, { hostname: `api-${machineName}.example.test` });
  return { spaceId, production, page, asset, parent, child, template, menu, note, tag };
}

describe('environment permission', () => {
  it('goes to owners and admins only', () => {
    expect(permissionsFor('owner')).toContain('environment:manage');
    expect(permissionsFor('admin')).toContain('environment:manage');
    expect(permissionsFor('editor')).not.toContain('environment:manage');
  });
});

describe('creating an environment', () => {
  it('copies config only under new ids, provider rows switched off', async () => {
    const seed = await freshSpace();
    const { environment, copied } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    expect(environment).toMatchObject({
      kind: 'staging',
      createdFrom: seed.production.id,
      createdMode: 'config',
    });
    const staging = rowsOf(environment);

    const [type] = await staging.types();
    expect(type?.name).toBe('page');
    expect(type?.id).toBe(contentTypeId(seed.spaceId, 'page', environment.id));
    expect(type?.id).not.toBe(seed.page.id);

    // Templates only, no documents.
    const contents = await staging.contents();
    expect(contents.map((row) => row.title)).toEqual(['Hero template']);
    expect(contents[0]?.id).not.toBe(seed.template.id);

    const menus = await staging.menus();
    expect(menus.map((row) => row.machineName)).toEqual(['main']);
    expect(await ctx.repos.environmentRows.children('menuItems', [menus[0]?.id as string])).toEqual(
      [],
    );
    const [copy] = await staging.notes();
    expect(copy).toMatchObject({ name: 'Notify', enabled: false, environmentId: environment.id });
    expect(copy?.id).not.toBe(seed.note.id);
    expect((await staging.redirects()).map((row) => row.fromPath)).toEqual(['/old']);
    expect(copied).toMatchObject({
      contentTypes: 1,
      contents: 1,
      menus: 1,
      menuItems: 0,
      notes: 1,
    });

    // Hosts stay with production.
    const scope = { spaceId: seed.spaceId, environmentId: environment.id };
    expect(await ctx.repos.spaceApiHosts.listBySpace(scope)).toEqual([]);
    expect((await ctx.repos.spaceApiHosts.listBySpace(seed.spaceId)).length).toBe(1);

    // Production is untouched.
    expect((await rowsOf(seed.production).contents()).length).toBe(3);
    expect((await rowsOf(seed.production).notes())[0]?.enabled).toBe(true);

    expect(await auditActions(seed.spaceId)).toContain('environment.create');
    expect(await eventTypes(seed.spaceId)).toContain('environment.created');
    // Registered for staging reads.
    expect(ctx.manablox.contentTypes.tryGet(type?.id as string)?.name).toBe('page');
  });

  it('copies content too in full mode, sharing assets', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'copy',
      name: 'Copy',
      mode: 'full',
    });
    const staging = rowsOf(environment);
    const contents = await staging.contents();
    expect(contents.map((row) => row.title).sort()).toEqual(['About', 'Hero template', 'Team']);
    const ids = new Set(contents.map((row) => row.id));
    for (const id of [seed.parent.id, seed.child.id, seed.template.id])
      expect(ids.has(id)).toBe(false);

    const about = contents.find((row) => row.title === 'About');
    const team = contents.find((row) => row.title === 'Team');
    expect(about?.typeId).toBe(contentTypeId(seed.spaceId, 'page', environment.id));
    expect(about?.fields).toEqual({ summary: 'kept', rating: 'five' });
    expect(team?.parentId).toBe(about?.id);
    expect(team?.path).toBe(`${about?.path}.${team?.id.replaceAll('-', '_')}`);
    expect(team?.localizationId).not.toBe(seed.child.localizationId);
    expect(team?.fields).toMatchObject({ hero: seed.asset.id });
    expect(team?.permalink).toBe(seed.child.permalink);

    expect((await staging.published()).map((row) => row.title).sort()).toEqual(['About', 'Team']);
    expect((await staging.usages()).map((row) => [row.assetId, row.contentId])).toEqual([
      [seed.asset.id, team?.id],
    ]);
    expect((await staging.tags()).map((row) => [row.tagId, row.localizationId])).toEqual([
      [seed.tag?.id, team?.localizationId],
    ]);
    const [menu] = await staging.menus();
    const items = await ctx.repos.environmentRows.children('menuItems', [menu?.id as string]);
    expect(items.map((row) => row.localizationId)).toEqual([about?.localizationId]);
    const redirects = await staging.redirects();
    expect(redirects.map((row) => row.toContentId).sort()).toEqual(
      [about?.localizationId, null].sort(),
    );
  });

  it('refuses without the feature, past the limit and for a taken name', async () => {
    const seed = await freshSpace();
    const scope = { kind: 'space' as const, id: seed.spaceId };
    const restore = await withControls(ctx, { scope, features: { environments: false } });
    expect(
      await keyOf(
        environments.create(seed.spaceId, { machineName: 'staging', name: 'S', mode: 'config' }),
      ),
    ).toBe('control.feature');
    await restore();

    // 0 allows no staging environment; production is not counted.
    const none = await withControls(ctx, {
      scope,
      values: { 'limits.environmentsPerSpace': { max: 0, mode: 'hard' } },
    });
    expect(
      await keyOf(
        environments.create(seed.spaceId, { machineName: 'zero', name: 'Z', mode: 'config' }),
      ),
    ).toBe('control.limit');
    await none();

    const limited = await withControls(ctx, {
      scope,
      values: { 'limits.environmentsPerSpace': { max: 1, mode: 'hard' } },
    });
    await environments.create(seed.spaceId, { machineName: 'one', name: 'One', mode: 'config' });
    expect(
      await keyOf(
        environments.create(seed.spaceId, { machineName: 'two', name: 'Two', mode: 'config' }),
      ),
    ).toBe('control.limit');
    await limited();

    expect(
      await keyOf(
        environments.create(seed.spaceId, { machineName: 'one', name: 'Again', mode: 'config' }),
      ),
    ).toBe('environment.machineName.taken');
    expect(
      await keyOf(
        environments.create(seed.spaceId, {
          machineName: 'production',
          name: 'P',
          mode: 'config',
        }),
      ),
    ).toBe('environment.machineName.invalid');
  });
});

describe('deleting an environment', () => {
  it('removes a staging environment with its rows; production stays', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'gone',
      name: 'Gone',
      mode: 'full',
    });
    const typeId = contentTypeId(seed.spaceId, 'page', environment.id);
    await environments.delete(seed.spaceId, 'gone');
    expect(await ctx.repos.environments.findById(environment.id)).toBeNull();
    expect(await rowsOf(environment).contents()).toEqual([]);
    expect(await rowsOf(environment).types()).toEqual([]);
    expect(ctx.manablox.contentTypes.tryGet(typeId)).toBeUndefined();
    expect((await rowsOf(seed.production).contents()).length).toBe(3);

    expect(await keyOf(environments.delete(seed.spaceId, 'production'))).toBe(
      'environment.production.undeletable',
    );
    expect(await auditActions(seed.spaceId)).toContain('environment.delete');
    expect(await eventTypes(seed.spaceId)).toContain('environment.deleted');
  });
});

describe('promoting an environment', () => {
  it('moves config, keeps production content and needs confirmation for removed fields', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const rows = ctx.repos.environmentRows;
    const [type] = await rowsOf(environment).types();
    if (!type) throw new Error('no type');
    // Drops `rating`, which production documents hold values for.
    await rows.update('contentTypes', type.id, {
      fields: type.fields.filter((field) => field.name !== 'rating'),
      label: 'Web page',
    });
    const [note] = await rowsOf(environment).notes();
    Object.assign(note as NoteRow, { name: 'Notify all', enabled: true });
    await ctx.repos.menus.create({
      spaceId: seed.spaceId,
      environmentId: environment.id,
      name: 'Footer',
      machineName: 'footer',
    });
    await ctx.contentTypes.create({
      name: 'news',
      spaceId: seed.spaceId,
      environmentId: environment.id,
      fields: [{ name: 'headline', type: 'string' }],
    });

    const diff = await environments.diff(seed.spaceId, 'staging', 'config');
    expect(diff.breaking).toBe(true);
    expect(diff.confirmRequired).toBe(true);
    const page = diff.contentTypes.find((entry) => entry.name === 'page');
    expect(page).toMatchObject({ id: seed.page.id, status: 'changed', documents: 1 });
    expect(page?.fields).toEqual([
      expect.objectContaining({ name: 'rating', status: 'removed', documents: 1 }),
    ]);
    expect(diff.contentTypes.find((entry) => entry.name === 'news')?.status).toBe('added');
    expect(diff.changes.find((entry) => entry.kind === 'menus')).toMatchObject({ added: 1 });
    expect(diff.changes.find((entry) => entry.kind === 'notes')).toMatchObject({ changed: 1 });

    expect(await keyOf(environments.promote(seed.spaceId, 'staging', 'config'))).toBe(
      'environment.promote.confirmRequired',
    );
    const result = await environments.promote(seed.spaceId, 'staging', 'config', {
      confirm: true,
    });
    expect(result.status).toBe('applied');
    expect(result.groups.map((group) => group.group)).toEqual([
      'contentTypes',
      'templates',
      'menus',
      'redirects',
      'notes',
    ]);

    const live = rowsOf(seed.production);
    const types = await live.types();
    const promoted = types.find((row) => row.name === 'page');
    expect(promoted?.id).toBe(seed.page.id);
    expect(promoted?.label).toBe('Web page');
    expect(promoted?.fields.map((field) => field.name)).toEqual(['summary']);
    expect(types.find((row) => row.name === 'news')?.id).toBe(contentTypeId(seed.spaceId, 'news'));
    // Documents are untouched; the removed field's value stays stored.
    const about = (await live.contents()).find((row) => row.id === seed.parent.id);
    expect(about?.fields).toEqual({ summary: 'kept', rating: 'five' });
    expect((await live.contents()).length).toBe(3);
    // Entries stay in a config promote.
    expect(
      (await rows.children('menuItems', [seed.menu.id])).map((row) => row.localizationId),
    ).toEqual([seed.parent.localizationId]);
    expect((await live.menus()).map((row) => row.machineName).sort()).toEqual(['footer', 'main']);
    // Provider rows go back under their production ids; production keeps its switch.
    expect(await live.notes()).toEqual([{ ...seed.note, name: 'Notify all' }]);
    expect(ctx.manablox.contentTypes.get(seed.page.id).label).toBe('Web page');

    expect(await auditActions(seed.spaceId)).toContain('environment.promote');
    expect(await eventTypes(seed.spaceId)).toContain('environment.promoted');
  });

  it('points promoted provider rows at production menus', async () => {
    const seed = await freshSpace();
    seed.note.menuId = seed.menu.id;
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const [copy] = await rowsOf(environment).notes();
    const [stagingMenu] = await rowsOf(environment).menus();
    expect(copy?.menuId).toBe(stagingMenu?.id);
    Object.assign(copy as NoteRow, { name: 'Renamed' });
    await environments.promote(seed.spaceId, 'staging', 'config');
    const [live] = await rowsOf(seed.production).notes();
    expect(live).toMatchObject({ name: 'Renamed', menuId: seed.menu.id });
  });

  it('leaves rows a provider does not promote, and production rows it keeps', async () => {
    const seed = await freshSpace();
    const code: NoteRow = { ...seed.note, id: randomUUID(), name: 'From code', source: 'code' };
    notes.set(code.id, code);
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    for (const row of await rowsOf(environment).notes()) {
      if (row.source === 'code') row.name = 'Edited in staging';
      else notes.delete(row.id);
    }
    const diff = await environments.diff(seed.spaceId, 'staging', 'config');
    expect(diff.changes.find((entry) => entry.kind === 'notes')).toMatchObject({
      added: 0,
      changed: 0,
      removed: 1,
    });
    await environments.promote(seed.spaceId, 'staging', 'config');
    expect(await rowsOf(seed.production).notes()).toEqual([code]);
  });

  it('replaces production content in full mode, keeping ids and hosts', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    const staging = rowsOf(environment);
    const rows = ctx.repos.environmentRows;
    const copies = await staging.contents();
    const about = copies.find((row) => row.title === 'About');
    const team = copies.find((row) => row.title === 'Team');
    await rows.update('contents', about?.id as string, { title: 'About us' });
    await rows.remove('contents', [team?.id as string]);
    await rows.remove('publishedContents', [team?.id as string]);
    const added = await ctx.content.create({
      spaceId: seed.spaceId,
      environmentId: environment.id,
      typeId: contentTypeId(seed.spaceId, 'page', environment.id),
      locale: 'en',
      title: 'Contact',
      slug: 'contact',
      fields: {},
    });

    // Pending approval requests: the unchanged template keeps its own; the changed and the
    // removed document lose theirs with the rows.
    for (const document of [seed.template, seed.parent, seed.child]) {
      await ctx.repos.approvals.request({
        spaceId: seed.spaceId,
        contentId: document.id,
        typeId: document.typeId,
        requestedBy: null,
        requestedByLabel: 'Test',
      });
    }

    expect(await keyOf(environments.promote(seed.spaceId, 'staging', 'full'))).toBe(
      'environment.promote.confirmRequired',
    );
    const result = await environments.promote(seed.spaceId, 'staging', 'full', { confirm: true });
    expect(result.status).toBe('applied');
    expect(result.diff.changes.find((entry) => entry.kind === 'contents')).toMatchObject({
      added: 1,
      changed: 1,
      removed: 1,
    });
    expect(await ctx.repos.approvals.findLatestByContent(seed.template.id)).toMatchObject({
      contentId: seed.template.id,
      status: 'pending',
    });
    for (const document of [seed.parent, seed.child]) {
      expect(await ctx.repos.approvals.findLatestByContent(document.id)).toBeNull();
    }

    const live = await rowsOf(seed.production).contents();
    expect(live.map((row) => row.title).sort()).toEqual(['About us', 'Contact', 'Hero template']);
    // Copied documents keep their production ids; new ones get fresh ones.
    expect(live.find((row) => row.title === 'About us')?.id).toBe(seed.parent.id);
    expect(live.find((row) => row.title === 'Hero template')?.id).toBe(seed.template.id);
    const contact = live.find((row) => row.title === 'Contact');
    expect(contact?.id).not.toBe(added.id);
    expect(contact?.typeId).toBe(seed.page.id);
    expect(await rowsOf(seed.production).usages()).toEqual([]);
    expect(await rowsOf(seed.production).tags()).toEqual([]);

    expect((await ctx.repos.spaceApiHosts.listBySpace(seed.spaceId)).length).toBe(1);
    // Staging keeps its own rows.
    expect((await staging.contents()).length).toBe(3);
  });

  it('takes a snapshot of production first when snapshots are on', async () => {
    const seed = await freshSpace();
    const scope = { kind: 'space' as const, id: seed.spaceId };
    await environments.create(seed.spaceId, { machineName: 'staging', name: 'S', mode: 'config' });
    const result = await environments.promote(seed.spaceId, 'staging', 'config');
    expect(result.snapshot).not.toBeNull();
    const [taken] = await snapshots.list(seed.spaceId);
    expect(taken).toMatchObject({ id: result.snapshot, trigger: 'promote' });

    const restore = await withControls(ctx, { scope, features: { snapshots: false } });
    const again = await environments.promote(seed.spaceId, 'staging', 'config');
    expect(again.snapshot).toBeNull();
    expect((await snapshots.list(seed.spaceId)).length).toBe(1);
    await restore();
  });

  it('rolls back a failed group, skips the rest and reports it', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const [type] = await rowsOf(environment).types();
    await ctx.repos.environmentRows.update('contentTypes', type?.id as string, { label: 'Moved' });
    await ctx.repos.redirects.create(
      { spaceId: seed.spaceId, environmentId: environment.id },
      { locale: null, fromPath: '/new-only', toPath: '/x', toContentId: null, status: 301 },
    );
    const [note] = await rowsOf(environment).notes();
    Object.assign(note as NoteRow, { name: 'New' });

    const original = EnvironmentRowsRepository.prototype.insert;
    const spy = vi
      .spyOn(EnvironmentRowsRepository.prototype, 'insert')
      .mockImplementation(async function (this: EnvironmentRowsRepository, kind, rows) {
        if (kind === 'redirects' && rows.length > 0) throw new Error('disk full');
        return original.call(this, kind, rows as never);
      });
    try {
      const result = await environments.promote(seed.spaceId, 'staging', 'config');
      expect(result.status).toBe('partial');
      expect(result.groups).toEqual([
        { group: 'contentTypes', status: 'applied', error: null },
        { group: 'templates', status: 'applied', error: null },
        { group: 'menus', status: 'applied', error: null },
        { group: 'redirects', status: 'failed', error: 'environment.promote.failed' },
        { group: 'notes', status: 'skipped', error: null },
      ]);
    } finally {
      spy.mockRestore();
    }
    const live = rowsOf(seed.production);
    expect((await live.types())[0]?.label).toBe('Moved');
    expect((await live.redirects()).map((row) => row.fromPath).sort()).toEqual([
      '/about-us',
      '/old',
    ]);
    expect((await live.notes())[0]?.name).toBe('Notify');
  });

  it('only promotes staging environments', async () => {
    const seed = await freshSpace();
    expect(await keyOf(environments.promote(seed.spaceId, 'production', 'config'))).toBe(
      'environment.promote.notStaging',
    );
    expect(await keyOf(environments.diff(seed.spaceId, 'missing', 'config'))).toBe(
      'environment.notFound',
    );
  });
});

const stagingScope = (spaceId: string, environment: SpaceEnvironmentRow) => ({
  spaceId,
  environmentId: environment.id,
  machineName: environment.machineName,
  production: false,
});

const settingsOf = async (spaceId: string) =>
  (await ctx.repos.spaces.findById(spaceId))?.settings ?? {};

/** The home nomination of an environment. */
const nominationsOf = (settings: Record<string, unknown>, stagingId: string | null) => ({
  homeContentId: nominationOf(settings, stagingId, HOME_NOMINATION),
});

describe('home nominations', () => {
  it('follow a full copy and a full promote; a config promote keeps them, a delete drops them', async () => {
    const seed = await freshSpace();
    await ctx.repos.spaces.update(seed.spaceId, {
      settings: {
        ...(await settingsOf(seed.spaceId)),
        homeContentId: seed.parent.id,
      },
    });
    const { environment: plain } = await environments.create(seed.spaceId, {
      machineName: 'plain',
      name: 'Plain',
      mode: 'config',
    });
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    const copies = await rowsOf(environment).contents();
    const about = copies.find((row) => row.title === 'About');
    const team = copies.find((row) => row.title === 'Team');
    expect(nominationsOf(await settingsOf(seed.spaceId), environment.id)).toEqual({
      homeContentId: about?.id,
    });
    expect(nominationsOf(await settingsOf(seed.spaceId), plain.id)).toEqual({
      homeContentId: null,
    });

    // Staging nominates another home.
    await ctx.spaces.setHome(stagingScope(seed.spaceId, environment), team?.id as string);
    await environments.promote(seed.spaceId, 'staging', 'config');
    expect(nominationsOf(await settingsOf(seed.spaceId), null)).toEqual({
      homeContentId: seed.parent.id,
    });
    await environments.promote(seed.spaceId, 'staging', 'full', { confirm: true });
    expect(nominationsOf(await settingsOf(seed.spaceId), null)).toEqual({
      homeContentId: seed.child.id,
    });

    await environments.delete(seed.spaceId, 'staging');
    const settings = await settingsOf(seed.spaceId);
    expect(nominationsOf(settings, environment.id).homeContentId).toBeNull();
    expect(Object.keys((settings.environments as object | undefined) ?? {})).not.toContain(
      environment.id,
    );
  });
});

describe('grants for staging types', () => {
  it('gives promoted types the grants roles hold on their staging ids', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const news = await ctx.contentTypes.create({
      name: 'news',
      spaceId: seed.spaceId,
      environmentId: environment.id,
      fields: [],
    });
    const role = await ctx.repos.roles.create(seed.spaceId, {
      name: 'Writer',
      machineName: 'writer',
      permissions: ['space:read', `content:read:${news.id}`, `content:update:${news.id}`],
    });
    await environments.promote(seed.spaceId, 'staging', 'config');
    const promoted = ctx.manablox.contentTypes.tryGetByName('news', seed.spaceId);
    expect(promoted?.id).toBeDefined();
    expect(promoted?.id).not.toBe(news.id);
    expect((await ctx.repos.roles.findById(role.id))?.permissions).toEqual([
      'space:read',
      `content:read:${news.id}`,
      `content:update:${news.id}`,
      `content:read:${promoted?.id}`,
      `content:update:${promoted?.id}`,
    ]);
    // The staging type now follows the production type's grants.
    expect(ctx.manablox.contentTypes.grantTypeId(news.id)).toBe(promoted?.id);
    expect(ctx.manablox.contentTypes.grantTypeId(seed.page.id)).toBe(seed.page.id);
  });

  it('notifies reviewers of a staging type by their production grant', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    const [type] = await rowsOf(environment).types();
    await ctx.repos.environmentRows.update('contentTypes', type?.id as string, {
      requiresApproval: true,
    });
    await ctx.contentTypes.reload();
    await ctx.repos.roles.create(seed.spaceId, {
      name: 'Page publisher',
      machineName: 'pagepub',
      permissions: [
        'space:read',
        `content:read:${seed.page.id}`,
        `content:publish:${seed.page.id}`,
      ],
    });
    const reviewer = await ctx.repos.users.create({
      name: `rev-${counter}`,
      email: `rev-${randomUUID().slice(0, 8)}@env.test`,
      role: 'editor',
      passwordHash: 'x',
    });
    await ctx.repos.users.grant(reviewer.id, seed.spaceId, 'pagepub');
    const about = (await rowsOf(environment).contents()).find((row) => row.title === 'About');
    await ctx.approvals.request(stagingScope(seed.spaceId, environment), about?.id as string, null);
    const notified = await ctx.notifications.list(reviewer.id, {
      kinds: ['content.approvalRequested'],
    });
    expect(notified.items.map((row) => row.targetId)).toEqual([about?.id]);
  });
});

describe('asset published state per environment', () => {
  it('keeps an asset only staging publishes out of production', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const asset = await ctx.repos.assets.create({
      spaceId: seed.spaceId,
      driver: 'local',
      key: `${seed.spaceId}/staged.jpg`,
      filename: 'staged.jpg',
      name: 'Staged',
      mimeType: 'image/jpeg',
      size: 5,
    });
    const scope = stagingScope(seed.spaceId, environment);
    const doc = await ctx.content.create({
      spaceId: seed.spaceId,
      environmentId: environment.id,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Staged',
      fields: { hero: asset.id },
    });
    await ctx.content.publish(scope, doc.id);

    const usages = ctx.repos.assetUsages;
    expect(await usages.filterPublished([asset.id, seed.asset.id])).toEqual(
      new Set([seed.asset.id]),
    );
    // Production's published assets count in staging too.
    expect(await usages.filterPublished([asset.id, seed.asset.id], environment.id)).toEqual(
      new Set([asset.id, seed.asset.id]),
    );
    const listed = async (stagingId?: string) =>
      (
        await ctx.repos.assets.page(
          { spaceId: seed.spaceId, published: true, stagingId },
          { limit: 10, offset: 0 },
        )
      ).items
        .map((row) => row.id)
        .sort();
    expect(await listed()).toEqual([seed.asset.id]);
    expect(await listed(environment.id)).toEqual([asset.id, seed.asset.id].sort());

    const loaders = (environmentScope: typeof scope | null) =>
      createLoaders(ctx.repos, true, {
        spaceId: seed.spaceId,
        environment: environmentScope,
        publishedAssetsOnly: true,
      });
    expect((await loaders(scope).asset.load(asset.id))?.id).toBe(asset.id);
    expect(await loaders(null).asset.load(asset.id)).toBeNull();
  });
});

describe('promote lock', () => {
  it('refuses production writes while held; staging writes pass and a stale marker expires', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const store = ctx.controlStore;
    const locks = store.promotes as PromoteLocks;
    // Another process: reads the database marker, uncached.
    const other = new PromoteLocks(ctx.repos, { check: 0 });
    const refusal = async (write: Promise<void>) => {
      try {
        await write;
      } catch (error) {
        if (ManabloxError.is(error)) return { key: error.key, params: error.details[0]?.params };
        throw error;
      }
      return null;
    };

    await locks.hold(seed.spaceId, seed.production.id, async () => {
      expect(await refusal(store.assertWritable(seed.spaceId))).toEqual({
        key: 'control.readOnly',
        params: {
          scope: `space:${seed.spaceId}`,
          reason: 'promote',
          message: 'A promote is in progress.',
        },
      });
      expect(
        await refusal(
          store.assertWritable({ spaceId: seed.spaceId, environmentId: seed.production.id }),
        ),
      ).toMatchObject({ key: 'control.readOnly' });
      expect(await refusal(store.assertWritable(stagingScope(seed.spaceId, environment)))).toBe(
        null,
      );
      expect(await refusal(store.assertWritable(ctx.spaceId))).toBe(null);
      expect(await other.held(seed.spaceId)).toMatchObject({ productionId: seed.production.id });
    });
    expect(await refusal(store.assertWritable(seed.spaceId))).toBe(null);
    expect(await other.held(seed.spaceId)).toBeNull();

    await ctx.repos.instanceMeta.set(`promote:${seed.spaceId}`, {
      productionId: seed.production.id,
      until: Date.now() - 1,
    });
    expect(await other.held(seed.spaceId)).toBeNull();
    await ctx.repos.instanceMeta.delete(`promote:${seed.spaceId}`);
  });

  it('is held while a promote runs and released when it fails', async () => {
    const seed = await freshSpace();
    const { environment } = await environments.create(seed.spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'config',
    });
    const [type] = await rowsOf(environment).types();
    await ctx.repos.environmentRows.update('contentTypes', type?.id as string, {
      fields: [],
    });
    const hold = vi.spyOn(ctx.controlStore.promotes as PromoteLocks, 'hold');
    try {
      // Removing fields production documents hold needs confirmation.
      expect(await keyOf(environments.promote(seed.spaceId, 'staging', 'config'))).toBe(
        'environment.promote.confirmRequired',
      );
      expect(hold).toHaveBeenCalledWith(seed.spaceId, seed.production.id, expect.any(Function));
    } finally {
      hold.mockRestore();
    }
    await ctx.controlStore.assertWritable(seed.spaceId);
  });
});
