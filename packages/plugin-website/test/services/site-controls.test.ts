import { defineContentType, definePlugin } from '@manablox/core';
import { builtinFieldTypes, stringField } from '@manablox/fields';
import { withControls } from '@manablox/services/testing';
import { defaultSiteSettings } from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';

let ctx: WebsiteContext;

/** A plugin field type: a string under another name. */
const colorField = { ...stringField, name: 'acmecolor' };
const plugin = definePlugin({ name: '@acme/colors', fieldTypes: [colorField] });
const swatch = defineContentType({
  name: 'swatch',
  kind: 'block',
  fields: [
    { name: 'label', type: 'string' },
    { name: 'color', type: 'acmecolor' },
    { name: 'inner', type: 'blocks', settings: { types: [] } },
  ],
});

beforeAll(async () => {
  ctx = await createWebsiteContext('site_controls', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      { name: 'swatch', kind: 'block', fields: swatch.fields },
      {
        name: 'page',
        fields: [
          { name: 'summary', type: 'string' },
          { name: 'color', type: 'acmecolor' },
          { name: 'sections', type: 'blocks', settings: { types: [swatch.id] } },
          {
            name: 'rows',
            type: 'repeater',
            settings: {
              fields: [
                { name: 'label', type: 'string' },
                { name: 'color', type: 'acmecolor' },
              ],
            },
          },
        ],
      },
      { name: 'contact', kind: 'data', fields: [{ name: 'name', type: 'string' }] },
    ],
    config: { plugins: [plugin] },
  });
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const freshSpace = async () => {
  const name = `ctl-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

const refused = (promise: Promise<unknown>) =>
  expect(promise).rejects.toMatchObject({ key: 'control.feature', status: 403 });

const off = (features: Record<string, boolean>, spaceId?: string) =>
  withControls(ctx, {
    ...(spaceId ? { scope: { kind: 'space', id: spaceId } } : {}),
    features,
  });

const form = (id: string) => ({
  id,
  el: 'form' as const,
  props: { databagTypeId: ctx.ids.contact },
  children: [{ id: `${id}-submit`, el: 'formSubmit' as const }],
});

const pageDesign = (...children: unknown[]) => ({
  root: { id: 'root', el: 'stack', children },
});

describe('customDomains', () => {
  it('off at the instance refuses new domains; off in a space leaves the others', async () => {
    const a = await freshSpace();
    const b = await freshSpace();
    const existing = await ctx.website.domains.create(a, { hostname: 'kept.test' });

    const restore = await off({ customDomains: false });
    try {
      await refused(ctx.website.domains.create(a, { hostname: 'new.test' }));
      expect((await ctx.website.domains.get(a, existing.id)).hostname).toBe('kept.test');
    } finally {
      await restore();
    }

    const restoreSpace = await off({ customDomains: false }, a);
    try {
      await refused(ctx.website.domains.create(a, { hostname: 'again.test' }));
      await ctx.website.domains.create(b, { hostname: 'other.test' });
    } finally {
      await restoreSpace();
    }
  });
});

describe('plugins.website.shareLinks', () => {
  it('refuses issuing share links where off', async () => {
    const a = await freshSpace();
    const b = await freshSpace();
    const restore = await off({ 'plugins.website.shareLinks': false }, a);
    try {
      await refused(ctx.website.designs.createShareLink(a, {}));
      expect((await ctx.website.designs.createShareLink(b, {})).token).toBeTruthy();
    } finally {
      await restore();
    }
  });
});

describe('plugins.website.forms', () => {
  it('refuses a draft that adds a form; one keeping its forms still saves', async () => {
    const spaceId = await freshSpace();
    const key = ctx.ids.page as string;
    const first = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'page',
      key,
      draft: pageDesign(form('kept')),
    });

    const restore = await off({ 'plugins.website.forms': false });
    try {
      await refused(
        ctx.website.designs.saveDraft(spaceId, {
          kind: 'page',
          key,
          draft: pageDesign(form('kept'), form('added')),
          expectedVersion: first.version,
        }),
      );
      const saved = await ctx.website.designs.saveDraft(spaceId, {
        kind: 'page',
        key,
        draft: pageDesign(form('kept'), { id: 'intro', el: 'text', props: { text: { en: 'Hi' } } }),
        expectedVersion: first.version,
      });
      expect(saved.version).toBe(first.version + 1);
    } finally {
      await restore();
    }
  });
});

describe('plugins.website.headCode', () => {
  it('refuses changing head or body-end code; other site settings still save', async () => {
    const spaceId = await freshSpace();
    const site = { ...defaultSiteSettings(), headCode: '<meta name="x">' };
    const first = await ctx.website.designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: site,
    });

    const restore = await off({ 'plugins.website.headCode': false }, spaceId);
    try {
      await refused(
        ctx.website.designs.saveDraft(spaceId, {
          kind: 'site',
          key: 'default',
          draft: { ...site, bodyEndCode: '<script></script>' },
          expectedVersion: first.version,
        }),
      );
      const saved = await ctx.website.designs.saveDraft(spaceId, {
        kind: 'site',
        key: 'default',
        draft: { ...site, name: 'Renamed', customCss: 'body{}' },
        expectedVersion: first.version,
      });
      expect(saved.draft).toMatchObject({ name: 'Renamed', headCode: '<meta name="x">' });
    } finally {
      await restore();
    }
  });
});

describe('plugin field types', () => {
  it('refuse writes to their fields where the plugin is off; reads and other fields stay open', async () => {
    const spaceId = await freshSpace();
    const other = await freshSpace();
    const typeId = ctx.ids.page as string;
    const row = await ctx.content.create({
      spaceId,
      typeId,
      locale: 'en',
      title: 'Colored',
      slug: 'colored',
      fields: { color: 'red' },
    });

    const restore = await off({ 'plugins.acme.colors': false }, spaceId);
    try {
      const save = (fields: Record<string, unknown>) =>
        ctx.content.update(spaceId, row.id, {
          spaceId,
          typeId,
          locale: 'en',
          title: 'Colored',
          slug: 'colored',
          fields,
        });
      await refused(save({ color: 'blue' }));
      const kept = await save({ color: 'red', summary: 'Still editable' });
      expect(kept.fields).toMatchObject({ color: 'red', summary: 'Still editable' });
      await refused(
        ctx.content.create({
          spaceId,
          typeId,
          locale: 'en',
          title: 'New',
          slug: 'new',
          fields: { color: 'green' },
        }),
      );
      await ctx.content.create({ spaceId, typeId, locale: 'en', title: 'Plain', fields: {} });
      await ctx.content.create({
        spaceId: other,
        typeId,
        locale: 'en',
        title: 'Elsewhere',
        fields: { color: 'green' },
      });
      expect((await ctx.content.get(spaceId, row.id))?.fields).toMatchObject({ color: 'red' });
    } finally {
      await restore();
    }
  });

  it('refuse changes to their fields inside blocks and items at any depth', async () => {
    const spaceId = await freshSpace();
    const typeId = ctx.ids.page as string;
    const blockId = '00000000-0000-4000-8000-000000000001';
    const innerId = '00000000-0000-4000-8000-000000000002';
    const itemId = '00000000-0000-4000-8000-000000000003';
    const block = (color: string, inner: string, label = 'Swatch') => ({
      blockId,
      type: swatch.id,
      fields: {
        label,
        color,
        inner: {
          blocks: [{ blockId: innerId, type: swatch.id, fields: { label: 'Inner', color: inner } }],
        },
      },
    });
    const rows = (color: string) => [{ itemId, fields: { label: 'Row', color } }];
    const fields = (color: string, inner: string, row: string, label?: string) => ({
      sections: { blocks: [block(color, inner, label)] },
      rows: rows(row),
    });
    const page = { spaceId, typeId, locale: 'en', title: 'Nested', slug: 'nested' };
    const row = await ctx.content.create({ ...page, fields: fields('red', 'red', 'red') });

    const restore = await off({ 'plugins.acme.colors': false }, spaceId);
    try {
      const save = (values: Record<string, unknown>) =>
        ctx.content.update(spaceId, row.id, { ...page, fields: values });
      await refused(save(fields('blue', 'red', 'red')));
      await refused(save(fields('red', 'blue', 'red')));
      await refused(save(fields('red', 'red', 'blue')));
      await refused(save({ sections: { blocks: [] }, rows: rows('red') }));
      const kept = await save(fields('red', 'red', 'red', 'Renamed'));
      expect(kept.fields).toMatchObject({
        sections: { blocks: [{ fields: { label: 'Renamed' } }] },
      });
      await refused(
        ctx.content.create({ ...page, slug: 'other', fields: { rows: rows('green') } }),
      );
      await ctx.content.create({ ...page, slug: 'plain', fields: { rows: [] } });
    } finally {
      await restore();
    }
  });
});
