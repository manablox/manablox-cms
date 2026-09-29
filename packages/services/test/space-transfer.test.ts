import { defineContentType, definePlugin, ManabloxError } from '@manablox/core';
import { RoleRepository, TagRepository } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineDataProvider } from '../src/data/provider.js';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import type { ExportedMenuItem, SpaceExport } from '../src/transfer/format.js';
import { decoPlugin } from './helpers/deco.js';
import { memoryStorage } from './helpers/storage.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
const storage = memoryStorage();
/** Keys left in the import staging area. */
const staged = () => [...storage.objects.keys()].filter((key) => key.startsWith('imports/'));

/** A note a plugin keeps per space, pointing at a credential. */
interface Note {
  id: string;
  text: string;
  credentialId: string | null;
}

/** The notes plugin's rows, by space; kept in memory, as only the transfer reads them. */
const notesBySpace = new Map<string, Note[]>();
/** The credential ids each notes import could look up, by space. */
const handedCredentials = new Map<string, string[]>();
const liveChanges: Array<{ spaceId: string; reason: string }> = [];

/** A plugin whose transfer section holds notes. */
const notesPlugin = definePlugin({
  name: 'notes',
  data: [
    defineDataProvider<Note, Note>({
      kind: 'notes.notes',
      environments: {
        load: async () => [],
        describe: (row) => ({ label: row.text, value: row }),
        copy: async () => {},
        promote: async () => {},
        onLiveChange: ({ spaceId, reason }) => {
          liveChanges.push({ spaceId, reason });
        },
      },
      transfer: {
        section: { label: 'Notes', dependsOn: ['credentials'] },
        count: async ({ spaceId }) => notesBySpace.get(spaceId)?.length ?? 0,
        export: async ({ spaceId }) => notesBySpace.get(spaceId) ?? [],
        ids: (entries) => entries.map((entry) => entry.id),
        async import({ spaceId, ids, notes }, entries) {
          handedCredentials.set(spaceId, [...ids.of('credentials').keys()]);
          notesBySpace.set(spaceId, entries);
          notes.push(`${entries.length} notes`);
        },
      },
    }),
  ],
});

beforeAll(async () => {
  ctx = await createServiceContext('transfer', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    storage,
    config: { plugins: [decoPlugin, notesPlugin] },
  });
});
afterAll(async () => {
  await ctx?.close();
});

/** The payload under a new space identity, for importing into the same instance. */
function asCopy(payload: SpaceExport, machineName: string): SpaceExport {
  const remap = new Map<string, string>();
  const fresh = (id: string) => {
    const mapped = remap.get(id) ?? crypto.randomUUID();
    remap.set(id, mapped);
    return mapped;
  };
  // Only the asset inside each teaser changes.
  const remapBlocks = (value: unknown) => {
    const laid = value as { blocks: { fields: Record<string, unknown> }[] };
    return {
      ...laid,
      blocks: laid.blocks.map((block) => ({
        ...block,
        fields: {
          ...block.fields,
          image: block.fields.image ? fresh(block.fields.image as string) : null,
        },
      })),
    };
  };
  const copy: SpaceExport = {
    ...payload,
    space: { ...payload.space, id: crypto.randomUUID(), machineName, name: machineName },
  };
  // Fresh document ids; references between them must stay intact.
  if (payload.contents) {
    copy.contents = payload.contents.map((c) => ({
      ...c,
      id: fresh(c.id),
      localizationId: fresh(c.localizationId),
      parentId: c.parentId ? fresh(c.parentId) : null,
      fields: {
        ...c.fields,
        related: c.fields.related ? fresh(c.fields.related as string) : null,
        hero: c.fields.hero ? fresh(c.fields.hero as string) : null,
        ...(c.fields.components ? { components: remapBlocks(c.fields.components) } : {}),
      },
      ...(c.versions
        ? {
            versions: c.versions.map((v) => ({
              ...v,
              snapshot: { ...v.snapshot, id: fresh(c.id) },
            })),
          }
        : {}),
    }));
  }
  const remapItem = (item: ExportedMenuItem): ExportedMenuItem => ({
    ...item,
    id: crypto.randomUUID(),
    localizationId: item.localizationId ? fresh(item.localizationId) : null,
    children: item.children.map(remapItem),
  });
  if (payload.menus) {
    copy.menus = payload.menus.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      items: m.items.map(remapItem),
    }));
  }
  if (payload.assets)
    copy.assets = payload.assets.map((a) => ({
      ...a,
      id: fresh(a.id),
      key: `${machineName}/${a.key}`,
    }));
  if (payload.roles) copy.roles = payload.roles.map((r) => ({ ...r, id: crypto.randomUUID() }));
  // Endpoints reference the credential id.
  if (payload.credentials) {
    copy.credentials = payload.credentials.map((c) => ({ ...c, id: fresh(c.id) }));
  }
  const notes = payload.plugins?.['notes.notes'] as Note[] | undefined;
  if (notes) {
    copy.plugins = {
      ...payload.plugins,
      'notes.notes': notes.map((note) => ({
        ...note,
        id: crypto.randomUUID(),
        credentialId: note.credentialId ? fresh(note.credentialId) : null,
      })),
    };
  }
  return copy;
}

/** An export without its timestamp, for comparing two imports of one file. */
const comparable = ({ exportedAt: _at, ...rest }: SpaceExport) => rest;

describe('space transfer', () => {
  let ownerId: string;
  let parentId: string;
  let assetId: string;
  let credentialId: string;

  beforeAll(async () => {
    const asset = await ctx.repos.assets.create({
      spaceId: ctx.spaceId,
      driver: 'local',
      key: 'transfer/hero.jpg',
      filename: 'hero.jpg',
      name: 'Hero',
      mimeType: 'image/jpeg',
      size: 10,
    });
    assetId = asset.id;
    const parent = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Parent',
      slug: 'parent',
      fields: { hero: asset.id },
    });
    // A second save, for history.
    await ctx.content.update(ctx.spaceId, parent.id, {
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      title: 'Parent',
      slug: 'parent',
      fields: { hero: asset.id },
    });
    const child = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Child',
      slug: 'child',
      parentId: parent.id,
      fields: { related: parent.id },
    });
    parentId = parent.id;
    await ctx.content.publish(ctx.spaceId, parent.id);
    await ctx.content.publish(ctx.spaceId, child.id);
    const menu = await ctx.menus.create({
      spaceId: ctx.spaceId,
      name: 'Main',
      machineName: 'main',
    });
    await ctx.menus.setItems(ctx.spaceId, menu.id, [
      {
        localizationId: parent.localizationId,
        children: [{ localizationId: child.localizationId }],
      },
    ]);
    await ctx.roles.create(ctx.spaceId, {
      name: 'Reviewer',
      machineName: 'reviewer',
      permissions: ['content:read'],
    });
    const credential = await ctx.repos.credentials.create({
      spaceId: ctx.spaceId,
      name: 'Mailer',
      slug: 'mailer',
      kind: 'bearer',
      data: 'ciphertext-only-this-instance-can-open',
      hint: 'cdef',
    });
    credentialId = credential.id;
    notesBySpace.set(ctx.spaceId, [
      { id: crypto.randomUUID(), text: 'Nudge', credentialId: credential.id },
    ]);
    await ctx.tags.setForContent(ctx.spaceId, parent.localizationId, ['Travel', 'Long Read']);
    await ctx.tags.setForAsset(ctx.spaceId, asset.id, ['Travel']);
    const owner = await ctx.repos.users.create({
      name: 'Importer',
      email: 'importer@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    ownerId = owner.id;
  });

  it('exports every section of a space, history and timestamps included', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId);

    expect(payload.manabloxSpaceExport).toBe(1);
    expect(payload.sections).toEqual([
      'contentTypes',
      'contents',
      'history',
      'assets',
      'menus',
      'roles',
      'credentials',
      'redirects',
      'notes.notes',
    ]);
    expect(payload.contents?.map((c) => c.title).sort()).toEqual(['Child', 'Parent']);
    const parent = payload.contents?.find((c) => c.id === parentId);
    expect(parent?.version).toBe(2);
    expect(parent?.versions?.map((v) => v.version)).toEqual([1, 2]);
    expect(parent?.createdAt).toBeTruthy();
    expect(payload.assets?.[0]).toMatchObject({ id: assetId, createdAt: expect.any(String) });
    expect(payload.menus?.[0]?.items[0]?.children[0]?.localizationId).toBeTruthy();
    expect(payload.roles?.map((r) => r.machineName)).toEqual(['reviewer']);
    expect(payload.plugins?.['notes.notes']).toEqual([
      expect.objectContaining({ text: 'Nudge', credentialId }),
    ]);
    // Shells only, never the ciphertext.
    expect(payload.credentials).toEqual([
      { id: credentialId, name: 'Mailer', slug: 'mailer', kind: 'bearer', provider: '' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('ciphertext');
  });

  it('exports only the sections asked for, and never history without documents', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId, {
      sections: ['contentTypes', 'history', 'roles'],
    });
    expect(payload.sections).toEqual(['contentTypes', 'roles']);
    expect(payload.contents).toBeUndefined();
    expect(payload.roles).toHaveLength(1);
    expect(payload.plugins).toBeUndefined();
  });

  it('imports a full export under a new identity, ids and references preserved', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId);
    const copy = asCopy(payload, 'copy');

    const result = await ctx.spaces.import(copy, ownerId);
    expect(result).toMatchObject({
      contents: 2,
      versions: 3,
      assets: 1,
      menus: 1,
      roles: 1,
      credentials: 1,
      plugins: { 'notes.notes': 1 },
      published: 2,
    });
    expect(result.sections).toEqual(payload.sections);
    expect(await ctx.repos.users.findSpaceRole(ownerId, result.spaceId)).toBe('owner');
    // Everything lands in the new space's production environment.
    const environments = await ctx.repos.environments.listBySpace(result.spaceId);
    expect(environments).toMatchObject([{ machineName: 'production', kind: 'production' }]);
    const imported = await ctx.repos.content.page(
      { spaceId: result.spaceId },
      { limit: 10, offset: 0 },
    );
    expect(imported.items.map((row) => row.environmentId)).toEqual([
      environments[0]?.id,
      environments[0]?.id,
    ]);

    const importedParent = copy.contents?.find((c) => c.title === 'Parent');
    const importedChild = copy.contents?.find((c) => c.title === 'Child');
    const child = await ctx.content.get(result.spaceId, importedChild?.id as string);
    expect(child?.parentId).toBe(importedParent?.id);
    expect(child?.status).toBe('published');

    // History, version and dates come from the source.
    const parent = await ctx.content.get(result.spaceId, importedParent?.id as string);
    expect(parent?.version).toBe(2);
    expect(parent?.createdAt.toISOString()).toBe(importedParent?.createdAt);
    const versions = await ctx.repos.content.pageVersions(importedParent?.id as string);
    expect(versions.items.map((v) => v.version)).toEqual([2, 1]);

    const nav = await ctx.menus.resolve(result.spaceId, 'main', 'en');
    expect(nav?.items[0]?.children[0]?.label).toBe('Child');
    expect((await ctx.roles.list(result.spaceId)).some((r) => r.machineName === 'reviewer')).toBe(
      true,
    );
    // After the credentials it depends on, whose restored ids it can look up.
    expect(notesBySpace.get(result.spaceId)).toEqual(copy.plugins?.['notes.notes']);
    expect(handedCredentials.get(result.spaceId)).toEqual([copy.credentials?.[0]?.id]);
    expect(result.notes).toEqual(['1 notes']);
    const restoredCredentials = await ctx.repos.credentials.listBySpace(result.spaceId);
    expect(restoredCredentials[0]).toMatchObject({ name: 'Mailer', data: null, hint: null });

    // The usage index is rebuilt.
    const importedAsset = copy.assets?.[0]?.id as string;
    expect(await ctx.repos.assetUsages.filterPublished([importedAsset])).toEqual(
      new Set([importedAsset]),
    );
  });

  it('carries the tags of documents and assets into the new space', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId);
    expect(payload.contents?.find((c) => c.title === 'Parent')?.tags).toEqual([
      'Long Read',
      'Travel',
    ]);
    expect(payload.assets?.[0]?.tags).toEqual(['Travel']);

    const copy = asCopy(payload, 'tagged');
    const result = await ctx.spaces.import(copy, ownerId);

    // The vocabulary is rebuilt in the target space, with its own tag rows.
    const vocabulary = await ctx.tags.list(result.spaceId);
    expect(vocabulary.map((tag) => tag.name)).toEqual(['Long Read', 'Travel']);
    expect(vocabulary.every((tag) => tag.spaceId === result.spaceId)).toBe(true);

    const imported = copy.contents?.find((c) => c.title === 'Parent');
    const byGroup = await ctx.tags.ofContent([imported?.localizationId as string]);
    expect(byGroup.get(imported?.localizationId as string)?.map((tag) => tag.name)).toEqual([
      'Long Read',
      'Travel',
    ]);

    const copiedAsset = copy.assets?.[0]?.id as string;
    const assetTags = await ctx.tags.ofAssets([copiedAsset], result.spaceId);
    expect(assetTags.get(copiedAsset)?.map((tag) => tag.name)).toEqual(['Travel']);
  });

  it('carries a blocks value with its grid, layouts and designs unchanged', async () => {
    // A `{ grid, blocks }` value must round-trip verbatim.
    const components = {
      grid: { desktop: { columns: 2 }, mobile: { columns: 1 } },
      blocks: [
        {
          blockId: crypto.randomUUID(),
          type: ctx.ids.teaser as string,
          fields: { headline: 'Left', image: assetId },
          layout: { column: 1, row: 1, mobile: { column: 1, row: 2 } },
          ext: { deco: { variant: 'dark', style: { background: 'color:primary' } } },
        },
        {
          blockId: crypto.randomUUID(),
          type: ctx.ids.teaser as string,
          fields: { headline: 'Right', image: null },
          layout: { column: 2, row: 1, columnSpan: 1 },
        },
      ],
    };
    const laidOut = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Laid out',
      slug: 'laid-out',
      fields: { components },
    });
    await ctx.content.publish(ctx.spaceId, laidOut.id);

    const payload = await ctx.spaces.export(ctx.spaceId, {
      sections: ['contentTypes', 'contents', 'assets'],
    });
    const exported = payload.contents?.find((c) => c.id === laidOut.id);
    expect(exported?.fields.components).toEqual(components);

    const copy = asCopy(payload, 'laid-out-copy');
    const result = await ctx.spaces.import(copy, ownerId);
    const imported = copy.contents?.find((c) => c.title === 'Laid out');
    const row = await ctx.content.get(result.spaceId, imported?.id as string);
    const restored = row?.fields.components as typeof components;
    expect(restored.grid).toEqual(components.grid);
    expect(restored.blocks.map((block) => block.layout)).toEqual(
      components.blocks.map((block) => block.layout),
    );
    expect(restored.blocks[0]?.ext).toEqual(components.blocks[0]?.ext);

    // Found via the rebuilt usage index.
    const copiedAsset = copy.assets?.[0]?.id as string;
    expect(restored.blocks[0]?.fields.image).toBe(copiedAsset);
    expect(await ctx.repos.assetUsages.filterPublished([copiedAsset])).toEqual(
      new Set([copiedAsset]),
    );
    expect(result.published).toBeGreaterThan(0);

    await ctx.content.delete(ctx.spaceId, laidOut.id);
  });

  it('restores only the sections asked for', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'partial');
    const result = await ctx.spaces.import(copy, ownerId, { sections: ['contents', 'roles'] });

    expect(result.sections).toEqual(['contents', 'roles']);
    expect(result).toMatchObject({ contents: 2, versions: 0, assets: 0, menus: 0, roles: 1 });
    const parent = await ctx.content.get(result.spaceId, copy.contents?.[0]?.id as string);
    expect(parent?.createdAt.toISOString()).toBe(copy.contents?.[0]?.createdAt);
    expect((await ctx.repos.content.pageVersions(parent?.id as string)).total).toBe(1);
    expect(await ctx.repos.menus.listBySpace(result.spaceId)).toEqual([]);
  });

  it('tells live-change listeners once the import is finished', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'announced');
    const result = await ctx.spaces.import(copy, ownerId, { sections: ['contents'] });
    expect(liveChanges).toContainEqual({ spaceId: result.spaceId, reason: 'import' });
  });

  it('adds this space to an asset the instance already has, rather than colliding', async () => {
    // Another space still holds the same asset ids.
    const payload = await ctx.spaces.export(ctx.spaceId, { sections: ['assets'] });
    const copy: SpaceExport = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: 'returning' },
    };
    const result = await ctx.spaces.import(copy, ownerId, { sections: ['assets'] });

    expect(result.assets).toBe(1);
    const spaces = (await ctx.repos.assets.listSpaceIdsByAssets([assetId])).get(assetId) ?? [];
    expect([...spaces].sort()).toEqual([ctx.spaceId, result.spaceId].sort());
  });

  it('lists what the space has to offer a transfer', async () => {
    const inventory = await ctx.spaces.inventory(ctx.spaceId);

    expect(inventory.contents.total).toBe(2);
    expect(inventory.contents.statuses).toEqual([
      { id: 'published', label: 'published', count: 2 },
    ]);
    expect(inventory.contents.locales).toEqual([{ id: 'en', label: 'en', count: 2 }]);
    expect(inventory.contents.types[0]?.count).toBe(2);
    expect(inventory.assets).toBe(1);
    expect(inventory.menus.map((m) => m.label)).toEqual(['Main']);
    expect(inventory.roles.map((m) => m.label)).toEqual(['Reviewer']);
    expect(inventory.credentials.map((m) => m.label)).toEqual(['Mailer']);
    expect(inventory.plugins).toEqual({ 'notes.notes': 1 });
  });

  it('exports only the entries of a section that were picked', async () => {
    const inventory = await ctx.spaces.inventory(ctx.spaceId);
    const reviewer = inventory.roles.find((role) => role.label === 'Reviewer');

    const payload = await ctx.spaces.export(ctx.spaceId, {
      sections: ['roles', 'menus'],
      ids: { roles: [reviewer?.id as string], menus: [] },
    });

    expect(payload.roles?.map((role) => role.name)).toEqual(['Reviewer']);
    // An empty list means none.
    expect(payload.menus).toEqual([]);
    expect(payload.contents).toBeUndefined();
  });

  it('narrows the documents by status, and leaves no orphan behind', async () => {
    const draft = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Draft child',
      slug: 'draft-child',
      parentId,
      fields: {},
    });

    const published = await ctx.spaces.export(ctx.spaceId, {
      sections: ['contents'],
      contents: { statuses: ['published'] },
    });
    expect(published.contents?.map((c) => c.title).sort()).toEqual(['Child', 'Parent']);

    // The draft's parent is filtered out, so the draft is dropped.
    const drafts = await ctx.spaces.export(ctx.spaceId, {
      sections: ['contents'],
      contents: { statuses: ['draft'] },
    });
    expect(drafts.contents).toEqual([]);

    await ctx.content.delete(ctx.spaceId, draft.id);
  });

  it('restores a chosen part of a file, ids and filters alike', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId);
    const copy = asCopy(payload, 'narrowed');
    const keep = copy.roles?.[0]?.id as string;

    const result = await ctx.spaces.import(copy, ownerId, {
      sections: ['contents', 'roles', 'menus'],
      ids: { roles: [keep], menus: [] },
      contents: { locales: ['de'] },
    });

    expect(result).toMatchObject({ contents: 0, roles: 1, menus: 0, assets: 0 });
    expect(
      await ctx.repos.content.page({ spaceId: result.spaceId }, { limit: 1, offset: 0 }),
    ).toMatchObject({
      total: 0,
    });
    expect(await ctx.repos.menus.listBySpace(result.spaceId)).toEqual([]);
    expect((await ctx.roles.list(result.spaceId)).some((r) => r.machineName === 'reviewer')).toBe(
      true,
    );
  });

  it('carries the publish date and the schedule of a document and an asset', async () => {
    const takedown = new Date('2030-01-01T00:00:00.000Z');
    const goLive = new Date('2031-06-01T00:00:00.000Z');
    await ctx.repos.content.setSchedule(parentId, { unpublishAt: takedown });
    await ctx.repos.assets.update(assetId, { publishAt: goLive, unpublishAt: takedown });

    const payload = await ctx.spaces.export(ctx.spaceId, {
      sections: ['contents', 'assets'],
    });
    const exported = payload.contents?.find((c) => c.id === parentId);
    expect(exported?.unpublishAt).toBe(takedown.toISOString());
    expect(exported?.publishedAt).toBeTruthy();
    expect(payload.assets?.[0]).toMatchObject({
      publishAt: goLive.toISOString(),
      unpublishAt: takedown.toISOString(),
    });

    const copy = asCopy(payload, 'scheduled');
    const result = await ctx.spaces.import(copy, ownerId);
    const restored = await ctx.content.get(
      result.spaceId,
      copy.contents?.find((c) => c.title === 'Parent')?.id as string,
    );
    // Not the moment of import.
    expect(restored?.unpublishAt?.toISOString()).toBe(takedown.toISOString());
    expect(restored?.publishedAt?.toISOString()).toBe(exported?.publishedAt);
    const [asset] = (
      await ctx.repos.assets.page({ spaceId: result.spaceId }, { limit: 1, offset: 0 })
    ).items;
    expect(asset?.publishAt?.toISOString()).toBe(goLive.toISOString());

    await ctx.repos.content.setSchedule(parentId, { unpublishAt: null });
    await ctx.repos.assets.update(assetId, { publishAt: null, unpublishAt: null });
  });

  it('refuses documents whose content type is neither in the file nor on this instance', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'orphaned');
    const missing = crypto.randomUUID();
    copy.contents = (copy.contents ?? []).map((c) => ({ ...c, typeId: missing }));

    await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
      key: 'space.import.typeMissing',
    });
    expect(await ctx.repos.spaces.findByMachineName('orphaned')).toBeNull();
  });

  it('stages files first, and a failed copy writes nothing and leaves no staging behind', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'unstaged');
    const key = copy.assets?.[0]?.key as string;
    const failing = vi.spyOn(storage, 'put').mockImplementation(async (target) => {
      if (target.endsWith(key)) throw new Error('disk full');
    });
    try {
      await expect(
        ctx.spaces.import(copy, ownerId, undefined, async (sink) => {
          await sink.put(key, Buffer.from('bytes'), { contentType: 'image/jpeg' });
        }),
      ).rejects.toThrow('disk full');
    } finally {
      failing.mockRestore();
    }
    expect(await ctx.repos.spaces.findById(copy.space.id)).toBeNull();
    expect(await ctx.repos.content.listByIds((copy.contents ?? []).map((c) => c.id))).toEqual([]);
    expect(staged()).toEqual([]);
  });

  it('stores archive files at their keys once the import finished', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId, { sections: ['assets'] }), 'filed');
    const key = copy.assets?.[0]?.key as string;
    const result = await ctx.spaces.import(copy, ownerId, undefined, async (sink) => {
      await sink.put(key, Buffer.from('bytes'), { contentType: 'image/jpeg' });
      // Not a restored asset: ignored.
      await sink.put('stray/file.txt', Buffer.from('x'), { contentType: 'text/plain' });
    });
    expect(result.files).toBe(1);
    expect(storage.objects.get(key)?.toString()).toBe('bytes');
    expect(storage.objects.has('stray/file.txt')).toBe(false);
    expect(staged()).toEqual([]);
  });

  it('keeps a space that fails midway as failed and hidden; resume finishes it like a clean import', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'doomed');
    const type = defineContentType({
      name: 'doomed_note',
      spaceId: copy.space.id,
      fields: [{ name: 'body', type: 'string' }],
    });
    copy.contentTypes = [...(copy.contentTypes ?? []), type];
    const spaceId = copy.space.id;
    // Fails after documents, assets and menus are written.
    const failing = vi
      .spyOn(TagRepository.prototype, 'seedForAssets')
      .mockRejectedValueOnce(new Error("EACCES: open '/srv/manablox/storage/imports/x.json'"));
    try {
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        key: 'space.import.failed',
        details: [{ params: { spaceId, step: 'tags' } }],
      });
    } finally {
      failing.mockRestore();
    }

    const failed = await ctx.repos.spaces.findById(spaceId);
    expect(failed).toMatchObject({
      importStatus: 'failed',
      importProgress: {
        step: 'tags',
        resumable: true,
        error: { key: 'internal.error', message: "EACCES: open '<path>'" },
      },
    });
    expect(await ctx.spaces.isReady(spaceId)).toBe(false);
    await expect(ctx.spaces.assertWritable(spaceId)).rejects.toMatchObject({
      key: 'space.importing',
    });
    // Committed steps stay, and nothing publishes before the space is ready.
    expect(await ctx.repos.content.listByIds((copy.contents ?? []).map((c) => c.id))).toHaveLength(
      copy.contents?.length ?? 0,
    );
    expect(
      await ctx.repos.content.listByIds(
        (copy.contents ?? []).map((c) => c.id),
        true,
      ),
    ).toEqual([]);
    expect(staged().length).toBeGreaterThan(0);

    const replay = vi.spyOn(TagRepository.prototype, 'seedForAssets');
    const resumed = await ctx.spaces.resumeImport(spaceId);
    replay.mockRestore();
    expect(resumed).toMatchObject({ spaceId, contentTypes: 1, contents: 2 });
    expect(await ctx.repos.spaces.findById(spaceId)).toMatchObject({
      importStatus: null,
      importProgress: null,
    });
    expect(await ctx.spaces.isReady(spaceId)).toBe(true);
    expect(ctx.manablox.contentTypes.tryGet(type.id)).toBeDefined();
    expect(staged()).toEqual([]);
    const afterResume = await ctx.spaces.export(spaceId);

    // The same file imported without interruption yields the same space.
    await ctx.spaces.delete(spaceId);
    const clean = await ctx.spaces.import(copy, ownerId);
    expect(clean).toEqual(resumed);
    const afterClean = await ctx.spaces.export(spaceId);
    expect(comparable(afterClean)).toEqual(comparable(afterResume));
  });

  it('deletes a failed import with its staging area', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'abandoned');
    const failing = vi
      .spyOn(TagRepository.prototype, 'seedForAssets')
      .mockRejectedValueOnce(ManabloxError.notFound('asset.notFound', { id: '/var/x/a1' }));
    try {
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        key: 'space.import.failed',
      });
    } finally {
      failing.mockRestore();
    }
    expect((await ctx.repos.spaces.findById(copy.space.id))?.importProgress?.error).toEqual({
      key: 'asset.notFound',
      params: { id: '<path>' },
      message: 'asset.notFound',
    });
    expect(staged().length).toBeGreaterThan(0);

    await ctx.spaces.delete(copy.space.id);
    expect(await ctx.repos.spaces.findById(copy.space.id)).toBeNull();
    expect(staged()).toEqual([]);
    await expect(ctx.spaces.resumeImport(copy.space.id)).rejects.toMatchObject({
      key: 'space.notFound',
    });
  });

  it('checks features and limits again on resume, less what the import wrote', async () => {
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId), 'rechecked');
    const spaceId = copy.space.id;
    // Fails at the roles, after documents, assets and menus.
    const failing = vi
      .spyOn(RoleRepository.prototype, 'create')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        details: [{ params: { spaceId, step: 'roles' } }],
      });
    } finally {
      failing.mockRestore();
    }

    for (const feature of ['spaceCreate', 'transferImport'] as const) {
      const restore = await withControls(ctx, { features: { [feature]: false } });
      try {
        await expect(ctx.spaces.resumeImport(spaceId)).rejects.toMatchObject({
          key: 'control.feature',
        });
      } finally {
        await restore();
      }
    }

    const restore = await withControls(ctx, {
      values: { 'limits.customRolesPerSpace': { max: 0, mode: 'hard' } },
    });
    try {
      await expect(ctx.spaces.resumeImport(spaceId)).rejects.toMatchObject({
        details: expect.arrayContaining([expect.objectContaining({ key: 'control.limit' })]),
      });
    } finally {
      await restore();
    }
    expect(await ctx.repos.spaces.findById(spaceId)).toMatchObject({
      importStatus: 'failed',
      importProgress: { step: 'roles', error: { key: 'control.limit' } },
    });

    // Rows written before the failure do not count twice.
    const menus = (await ctx.repos.menus.listBySpace(spaceId)).length;
    expect(menus).toBeGreaterThan(0);
    const exact = await withControls(ctx, {
      values: { 'limits.menusPerSpace': { max: menus, mode: 'hard' } },
    });
    try {
      await expect(ctx.spaces.resumeImport(spaceId)).resolves.toMatchObject({ spaceId });
    } finally {
      await exact();
    }
  });

  it('refuses to resume a ready space or one still importing', async () => {
    await expect(ctx.spaces.resumeImport(ctx.spaceId)).rejects.toMatchObject({
      key: 'space.import.notResumable',
    });
    const copy = asCopy(await ctx.spaces.export(ctx.spaceId, { sections: ['roles'] }), 'busy');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = RoleRepository.prototype.create;
    const hold = vi.spyOn(RoleRepository.prototype, 'create').mockImplementation(async function (
      this: RoleRepository,
      ...args
    ) {
      await gate;
      return original.apply(this, args);
    });
    const importing = ctx.spaces.import(copy, ownerId);
    try {
      // A second runner while the first is mid-step.
      await vi.waitFor(() => expect(hold).toHaveBeenCalled());
      await expect(ctx.spaces.resumeImport(copy.space.id)).rejects.toMatchObject({
        key: 'space.import.running',
      });
    } finally {
      release();
      hold.mockRestore();
    }
    await importing;
  });

  it('refuses to import a space the instance already has', async () => {
    const payload = await ctx.spaces.export(ctx.spaceId);
    await expect(ctx.spaces.import(payload, null as never)).rejects.toMatchObject({
      key: 'space.import.exists',
    });
  });

  it('rejects a file that is not an export, and one of another format version', async () => {
    await expect(ctx.spaces.import({ hello: 'world' }, 'x')).rejects.toMatchObject({
      key: 'space.import.notAnExport',
    });
    for (const version of [0, 2]) {
      await expect(
        ctx.spaces.import(
          { manabloxSpaceExport: version, space: { id: 'a', machineName: 'b' } },
          'x',
        ),
      ).rejects.toMatchObject({ key: 'space.import.versionUnsupported' });
    }
  });
});
