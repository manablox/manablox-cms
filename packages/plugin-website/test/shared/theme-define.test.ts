import { definePlugin, type ManabloxPlugin } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { describe, expect, it } from 'vitest';
import { websitePlugin } from '../../src/server/plugin.js';
import { websiteServices } from '../../src/server/services/index.js';
import { defineTheme } from '../../src/server/theme-define.js';

const base = {
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'x'.repeat(32) },
};

describe('defineTheme', () => {
  it('fills defaults and keeps the id as the slug', () => {
    const theme = defineTheme({
      id: 'harbour',
      designs: [{ kind: 'menu', key: 'main', data: {} }],
    });
    expect(theme).toMatchObject({
      slug: 'harbour',
      name: 'Harbour',
      description: '',
      spaces: '*',
      theme: null,
      site: null,
    });
  });

  it('refuses an invalid id and designs of an unknown kind', () => {
    expect(() => defineTheme({ id: 'Not Valid' })).toThrow(/codeResource.slug.invalid/);
    expect(() =>
      defineTheme({ id: 'x', designs: [{ kind: 'theme' as never, key: 'default', data: {} }] }),
    ).toThrow(/plugins.website.theme.code.invalid/);
  });

  it('is contributed by the website plugin and others, duplicates refused', () => {
    const own = defineTheme({ id: 'own' });
    const acme = definePlugin({
      name: '@acme/themes',
      contributions: { website: { themes: [defineTheme({ id: 'acme' })] } },
    });
    const themesOf = (plugins: ManabloxPlugin[]) => {
      const manablox = new Manablox({ ...base, plugins: [...plugins] });
      const plugin = manablox.plugin('website');
      return { plugin, manablox };
    };
    const { plugin } = themesOf([websitePlugin({ themes: [own] }), acme]);
    expect(plugin.contributions('themes').map((entry) => [entry.plugin, entry.entry])).toEqual([
      ['website', expect.objectContaining({ slug: 'own' })],
      ['acme.themes', expect.objectContaining({ slug: 'acme' })],
    ]);
    const twice = themesOf([
      websitePlugin({ themes: [own] }),
      definePlugin({ name: 'more', contributions: { website: { themes: [own] } } }),
    ]);
    expect(() =>
      websiteServices({})({
        plugin: twice.plugin,
        manablox: twice.manablox,
        logger: twice.manablox.logger,
        repos: undefined as never,
        db: undefined as never,
        cache: undefined as never,
      }),
    ).toThrow(/codeResource.duplicate/);
  });
});
