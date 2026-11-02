import { builtinFieldTypes } from '@manablox/fields';
import { normaliseHostname } from '@manablox/services';
import { defaultSiteSettings, defaultTheme } from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySiteShare } from '../../src/server/share.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;

beforeAll(async () => {
  ctx = await createWebsiteContext('site', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;

/** A space of its own, so revision and listing checks see only this test's rows. */
const freshSpace = async (locales = ['en']) => {
  const name = `site-${++counter}`;
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

const revision = async (spaceId: string) => (await ctx.website.settings.get(spaceId)).revision;

const article = (spaceId: string, slug: string, parentId: string | null = null) =>
  ctx.content.create({
    spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    parentId,
    title: slug,
    slug,
    fields: {},
  });

describe('site designs', () => {
  it('lists implied designs as generated and returns defaults for theme and site', async () => {
    const spaceId = await freshSpace();
    const list = await ctx.website.designs.list(spaceId);
    const keys = list.map((entry) => `${entry.kind}:${entry.key}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'theme:default',
        'site:default',
        'layout:default',
        `block:${ctx.ids.teaser}`,
        `page:${ctx.ids.article}`,
      ]),
    );
    expect(list.every((entry) => entry.status === 'generated')).toBe(true);

    const theme = await ctx.website.designs.get(spaceId, 'theme', 'default');
    expect(theme).toMatchObject({ status: 'generated', design: null, data: defaultTheme() });
    expect(
      (await ctx.website.designs.get(spaceId, 'block', ctx.ids.teaser as string)).data,
    ).toBeNull();
  });

  it('saves drafts with an optimistic version and refuses a stale one', async () => {
    const spaceId = await freshSpace();
    const first = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'theme',
      key: 'default',
      draft: defaultTheme(),
    });
    expect(first.version).toBe(1);
    expect((await ctx.website.designs.get(spaceId, 'theme', 'default')).status).toBe('unpublished');

    const second = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'theme',
      key: 'default',
      draft: defaultTheme(),
      expectedVersion: 1,
    });
    expect(second.version).toBe(2);

    await expect(
      ctx.website.designs.saveDraft(spaceId, {
        kind: 'theme',
        key: 'default',
        draft: defaultTheme(),
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ key: 'plugins.website.design.versionConflict', kind: 'conflict' });
    // A generated design is created once; a second first save conflicts.
    await expect(
      ctx.website.designs.saveDraft(spaceId, {
        kind: 'theme',
        key: 'default',
        draft: defaultTheme(),
      }),
    ).rejects.toMatchObject({ key: 'plugins.website.design.versionConflict' });
  });

  it('validates the key and the draft', async () => {
    const spaceId = await freshSpace();
    await expect(
      ctx.website.designs.saveDraft(spaceId, {
        kind: 'theme',
        key: 'other',
        draft: defaultTheme(),
      }),
    ).rejects.toMatchObject({ key: 'plugins.website.design.validation.failed' });
    await expect(
      ctx.website.designs.saveDraft(spaceId, {
        kind: 'block',
        key: ctx.ids.article as string,
        draft: {},
      }),
    ).rejects.toMatchObject({
      key: 'plugins.website.design.validation.failed',
      details: [expect.objectContaining({ key: 'plugins.website.design.key.invalid' })],
    });
    await expect(
      ctx.website.designs.saveDraft(spaceId, { kind: 'theme', key: 'default', draft: 42 }),
    ).rejects.toMatchObject({
      key: 'plugins.website.design.validation.failed',
      details: expect.arrayContaining([
        expect.objectContaining({ key: 'plugins.website.design.invalid' }),
      ]),
    });
  });

  it('publishes one design, snapshots it and bumps the revision once', async () => {
    const spaceId = await freshSpace();
    const row = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: defaultSiteSettings(),
    });
    const published = await ctx.website.designs.publish(spaceId, row.id);
    expect(published.published).toEqual(defaultSiteSettings());
    expect(published.publishedVersion).toBe(1);
    expect(await revision(spaceId)).toBe(1);

    // A clean design publishes nothing.
    await ctx.website.designs.publish(spaceId, row.id);
    expect(await revision(spaceId)).toBe(1);

    const versions = await ctx.website.designs.versions(spaceId, row.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1 });
    expect(versions[0]).not.toHaveProperty('data');
  });

  it('publishes every dirty design in one go', async () => {
    const spaceId = await freshSpace();
    await ctx.website.designs.saveDraft(spaceId, {
      kind: 'theme',
      key: 'default',
      draft: defaultTheme(),
    });
    await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: defaultSiteSettings(),
    });
    const result = await ctx.website.designs.publishAll(spaceId);
    expect(result.published).toHaveLength(2);
    expect(result.revision).toBe(1);
    expect(await revision(spaceId)).toBe(1);

    const again = await ctx.website.designs.publishAll(spaceId);
    expect(again).toEqual({ published: [], revision: 1 });
    const statuses = (await ctx.website.designs.list(spaceId))
      .filter((entry) => entry.id)
      .map((entry) => entry.status);
    expect(statuses).toEqual(['published', 'published']);
  });

  it('discards a draft, restores a version and resets to generated', async () => {
    const spaceId = await freshSpace();
    const site = defaultSiteSettings();
    const row = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: site,
    });
    await ctx.website.designs.publish(spaceId, row.id);
    const edited = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: { ...site, name: 'Edited' },
      expectedVersion: 1,
    });
    expect((await ctx.website.designs.get(spaceId, 'site', 'default')).status).toBe('changed');

    const discarded = await ctx.website.designs.discardDraft(spaceId, edited.id);
    expect(discarded?.draft).toEqual(site);
    expect((await ctx.website.designs.get(spaceId, 'site', 'default')).status).toBe('published');

    const [version] = await ctx.website.designs.versions(spaceId, row.id);
    const changed = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: { ...site, name: 'Again' },
      expectedVersion: discarded?.version as number,
    });
    const restored = await ctx.website.designs.restore(spaceId, row.id, version?.id as string);
    expect(restored.draft).toEqual(site);
    expect(restored.version).toBe(changed.version + 1);

    const before = await revision(spaceId);
    await ctx.website.designs.delete(spaceId, row.id);
    expect((await ctx.website.designs.get(spaceId, 'site', 'default')).status).toBe('generated');
    expect(await revision(spaceId)).toBe(before + 1);
  });

  it('discarding a never published design resets it to generated', async () => {
    const spaceId = await freshSpace();
    const row = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'theme',
      key: 'default',
      draft: defaultTheme(),
    });
    expect(await ctx.website.designs.discardDraft(spaceId, row.id)).toBeNull();
    expect((await ctx.website.designs.get(spaceId, 'theme', 'default')).status).toBe('generated');
  });

  it('audits design writes', async () => {
    const spaceId = await freshSpace();
    const row = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'theme',
      key: 'default',
      draft: defaultTheme(),
    });
    await ctx.website.designs.publish(spaceId, row.id);
    const entries = await ctx.repos.audit.page({ spaceId, targetKind: 'website.design' });
    expect(entries.items.map((entry) => entry.action).sort()).toEqual([
      'website.design.publish',
      'website.design.save',
    ]);
  });

  it('signs share links the site can verify', async () => {
    const spaceId = await freshSpace();
    const doc = await article(spaceId, 'shared');
    const link = await ctx.website.designs.createShareLink(spaceId, {
      contentId: doc.id,
      expiresInSeconds: 3600,
    });
    const payload = verifySiteShare('test', link.token);
    expect(payload).toMatchObject({ spaceId, contentId: doc.id });
    expect(verifySiteShare('other', link.token)).toBeNull();
    expect(verifySiteShare('test', link.token, new Date(Date.now() + 7200_000))).toBeNull();

    await expect(
      ctx.website.designs.createShareLink(spaceId, { expiresInSeconds: 10 }),
    ).rejects.toMatchObject({ key: 'plugins.website.design.share.invalidExpiry' });
    await expect(
      ctx.website.designs.createShareLink(ctx.spaceId, { contentId: doc.id }),
    ).rejects.toMatchObject({ key: 'content.notFound' });
  });
});

describe('space site settings', () => {
  it('defaults to external and validates what is set', async () => {
    const spaceId = await freshSpace();
    expect(await ctx.website.settings.get(spaceId)).toEqual({
      mode: 'external',
      revision: 0,
      localeStrategy: 'prefix',
      notFoundContentId: null,
      password: null,
    });
    const doc = await article(spaceId, 'missing');
    const saved = await ctx.website.settings.set(spaceId, {
      mode: 'designed',
      notFoundContentId: doc.id,
    });
    expect(saved).toMatchObject({
      mode: 'designed',
      notFoundContentId: doc.id,
    });

    const other = await article(ctx.spaceId, 'elsewhere');
    await expect(
      ctx.website.settings.set(spaceId, { notFoundContentId: other.id }),
    ).rejects.toMatchObject({ key: 'plugins.website.settings.validation.failed' });
  });

  it('keeps the site settings through a plain settings update and clears a deleted 404 page', async () => {
    const spaceId = await freshSpace();
    const doc = await article(spaceId, 'gone');
    await ctx.website.settings.set(spaceId, { mode: 'designed', notFoundContentId: doc.id });
    await ctx.spaces.update(spaceId, { settings: { site: { mode: 'external' }, other: 1 } });
    const space = await ctx.repos.spaces.findById(spaceId);
    expect(space?.settings.other).toBe(1);
    expect((await ctx.website.settings.get(spaceId)).mode).toBe('designed');

    await ctx.content.delete(spaceId, doc.id);
    expect((await ctx.website.settings.get(spaceId)).notFoundContentId).toBeNull();
  });
});

describe('site domains', () => {
  it('normalises host names', () => {
    expect(normaliseHostname('  WWW.Example.COM.  ')).toBe('www.example.com');
    expect(normaliseHostname('example.com:8080')).toBe('example.com');
    expect(normaliseHostname('https://Example.com/path?x=1')).toBe('example.com');
    expect(normaliseHostname('bücher.de')).toBe('xn--bcher-kva.de');
    expect(normaliseHostname('localhost')).toBe('localhost');
    expect(normaliseHostname('-bad-.com')).toBeNull();
    expect(normaliseHostname('two words.com')).toBeNull();
    expect(normaliseHostname('')).toBeNull();
  });

  it('keeps host names unique across spaces and one primary per locale', async () => {
    const spaceId = await freshSpace(['en', 'de']);
    const otherId = await freshSpace();
    const first = await ctx.website.domains.create(spaceId, { hostname: 'First.test' });
    expect(first).toMatchObject({ hostname: 'first.test', isPrimary: true, locale: null });

    await expect(
      ctx.website.domains.create(otherId, { hostname: 'first.test.' }),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'plugins.website.domain.hostname.taken' })],
    });
    await expect(
      ctx.website.domains.create(spaceId, { hostname: 'x.test', locale: 'fr' }),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'plugins.website.domain.locale.unknown' })],
    });

    const second = await ctx.website.domains.create(spaceId, {
      hostname: 'www.first.test',
      redirectToPrimary: true,
    });
    expect(second.isPrimary).toBe(false);
    const german = await ctx.website.domains.create(spaceId, {
      hostname: 'erste.test',
      locale: 'de',
    });
    expect(german.isPrimary).toBe(true);

    expect(await ctx.website.domains.resolveHost('WWW.first.test:443')).toEqual({
      spaceId,
      environmentId: (await ctx.repos.environments.production(spaceId))?.id,
      hostname: 'www.first.test',
      locale: null,
      redirectTo: 'first.test',
    });
    expect(await ctx.website.domains.resolveHost('unknown.test')).toBeNull();

    await ctx.website.domains.update(spaceId, second.id, { isPrimary: true });
    const rows = await ctx.website.domains.list(spaceId);
    expect(
      rows
        .filter((row) => row.isPrimary)
        .map((row) => row.hostname)
        .sort(),
    ).toEqual(['erste.test', 'www.first.test']);
    expect(rows.find((row) => row.id === second.id)?.redirectToPrimary).toBe(false);

    await ctx.website.domains.delete(spaceId, first.id);
    expect(await ctx.website.domains.resolveHost('first.test')).toBeNull();
  });
});
