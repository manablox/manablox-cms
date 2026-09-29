import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { defineContentType } from '../src/content-type.js';
import { definePlugin } from '../src/plugin.js';

const base = {
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'x'.repeat(32) },
};

describe('plugin resource kinds', () => {
  const shelf = definePlugin({ name: 'shelf', resourceKinds: { 'shelf.book': {} } });
  const book = (slug: string) => ({ slug, spaces: '*' as const });

  it('collects entries of a kind from the config and plugins', () => {
    const resolved = resolveConfig({
      ...base,
      resources: { plugins: { 'shelf.book': [book('own')] } },
      plugins: [shelf, definePlugin({ name: 'more', resources: { 'shelf.book': [book('more')] } })],
    });
    expect(resolved.resources.plugins['shelf.book']).toEqual([
      expect.objectContaining({ slug: 'own', sourceRef: 'config' }),
      expect.objectContaining({ slug: 'more', sourceRef: 'more' }),
    ]);
  });

  it('refuses kinds no loaded plugin owns, foreign prefixes and duplicates', () => {
    expect(() =>
      resolveConfig({ ...base, resources: { plugins: { 'shelf.book': [book('a')] } } }),
    ).toThrow(/plugin.key.invalid/);
    expect(() =>
      resolveConfig({
        ...base,
        plugins: [definePlugin({ name: 'other', resourceKinds: { 'shelf.book': {} } })],
      }),
    ).toThrow(/plugin.key.invalid/);
    expect(() =>
      resolveConfig({
        ...base,
        resources: { plugins: { 'shelf.book': [book('a')] } },
        plugins: [shelf, definePlugin({ name: 'more', resources: { 'shelf.book': [book('a')] } })],
      }),
    ).toThrow(/codeResource.duplicate/);
  });
});

describe('content type plugin data', () => {
  const hero = { name: 'hero', kind: 'block' as const, fields: [], plugins: { acme: { size: 1 } } };
  const acme = definePlugin({
    name: 'acme',
    contentTypeData: {
      validate: (value, type) =>
        type.kind === 'block' && (value as { size?: unknown }).size === 1
          ? []
          : [{ path: ['size'], message: 'must be 1' }],
    },
  });

  it('keeps the data a plugin accepts', () => {
    const config = resolveConfig({ ...base, contentTypes: [hero], plugins: [acme] });
    expect(config.contentTypes[0]?.plugins).toEqual({ acme: { size: 1 } });
    expect(defineContentType({ name: 'plain', fields: [] })).not.toHaveProperty('plugins');
  });

  it('refuses data no plugin checks, or that its check fails', () => {
    expect(() => resolveConfig({ ...base, contentTypes: [hero] })).toThrow(
      /contentType.plugin.unknown/,
    );
    expect(() =>
      resolveConfig({
        ...base,
        contentTypes: [{ ...hero, plugins: { acme: { size: 2 } } }],
        plugins: [acme],
      }),
    ).toThrow(/contentType.plugin.invalid/);
  });
});
