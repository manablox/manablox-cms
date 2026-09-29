import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import type { Controls } from '../src/controls/index.js';
import { ManabloxError } from '../src/errors.js';
import { Manablox } from '../src/manablox.node.js';
import { definePlugin, type ManabloxPlugin } from '../src/plugin.js';
import { CLI_CORE_COMMANDS } from '../src/plugin-cli.js';
import { extensionPoint } from '../src/plugin-contributions.js';
import { orderPlugins } from '../src/plugin-graph.js';

const plugin = (name: string, links: Pick<ManabloxPlugin, 'requires' | 'enhances'> = {}) =>
  definePlugin({ name, ...links });

const instances: Manablox[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
});
/** An instance stopped after the test. */
const started = (manablox: Manablox) => {
  instances.push(manablox);
  return manablox;
};

const names = (plugins: ManabloxPlugin[]) => plugins.map((entry) => entry.name);

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (ManabloxError.is(error)) return { key: error.key, params: error.details[0]?.params };
    throw error;
  }
  throw new Error('not refused');
};

describe('plugin order', () => {
  it('keeps config order without links', () => {
    expect(names(orderPlugins([plugin('a'), plugin('b'), plugin('c')]))).toEqual(['a', 'b', 'c']);
  });

  it('boots required and enhanced plugins first', () => {
    const order = orderPlugins([
      plugin('a', { requires: ['c'] }),
      plugin('b', { enhances: ['d', 'missing'] }),
      plugin('c'),
      plugin('d'),
    ]);
    expect(names(order)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('lets soft links in both directions give way, in config order', () => {
    const order = orderPlugins([
      plugin('writer', { enhances: ['flows'] }),
      plugin('flows', { enhances: ['writer'] }),
      plugin('hooks', { enhances: ['flows'] }),
    ]);
    expect(names(order)).toEqual(['writer', 'flows', 'hooks']);
  });

  it('never lets a soft link break a hard one', () => {
    const order = orderPlugins([
      plugin('a', { enhances: ['b'] }),
      plugin('b', { requires: ['a'] }),
    ]);
    expect(names(order)).toEqual(['a', 'b']);
  });

  it('refuses a missing requirement', () => {
    expect(refusal(() => orderPlugins([plugin('a', { requires: ['b'] })]))).toEqual({
      key: 'plugin.requires.missing',
      params: { plugin: 'a', requires: 'b' },
    });
  });

  it('refuses a cycle of requirements', () => {
    const plugins = [
      plugin('a', { requires: ['b'] }),
      plugin('b', { requires: ['c'] }),
      plugin('c', { requires: ['a'] }),
    ];
    expect(refusal(() => orderPlugins(plugins))).toEqual({
      key: 'plugin.requires.cycle',
      params: { plugins: ['a', 'b', 'c', 'a'] },
    });
    expect(refusal(() => orderPlugins([plugin('self', { requires: ['self'] })])).key).toBe(
      'plugin.requires.cycle',
    );
  });

  it('refuses a plugin whose id is a manablox command', () => {
    expect(refusal(() => orderPlugins([plugin('Plugin')]))).toEqual({
      key: 'plugin.id.reserved',
      params: { plugin: 'Plugin', id: 'plugin' },
    });
    for (const command of CLI_CORE_COMMANDS) {
      expect(refusal(() => orderPlugins([plugin(command)])).key).toBe('plugin.id.reserved');
    }
    // A scope makes it another id.
    expect(names(orderPlugins([plugin('@acme/start')]))).toEqual(['@acme/start']);
  });

  it('orders the resolved config', () => {
    const config = resolveConfig({
      database: { url: 'postgres://unused' },
      auth: { secret: 's' },
      plugins: [plugin('@acme/b', { requires: ['acme.a'] }), plugin('@acme/a')],
    });
    expect(names(config.plugins)).toEqual(['@acme/a', '@acme/b']);
  });
});

describe('plugin lookup', () => {
  const instance = () =>
    started(
      new Manablox({
        database: { url: 'postgres://unused' },
        auth: { secret: 's' },
        logLevel: 'silent',
        plugins: [plugin('provider'), plugin('consumer', { requires: ['provider'] })],
      }),
    );

  it('hands out the services of configured plugins', () => {
    const manablox = instance();
    const services = { greet: () => 'hi' };
    manablox.providePlugin('provider', { services });
    const lookup = manablox.plugin('consumer').plugins;
    expect(lookup.has('provider')).toBe(true);
    expect(lookup.get('provider')).toBe(services);
    expect(lookup.has('absent')).toBe(false);
    expect(lookup.get('absent')).toBeUndefined();
    expect(lookup.get('consumer')).toBeUndefined();
  });

  it('checks the flag of another plugin', async () => {
    const manablox = instance();
    const off = new Set(['plugins.provider']);
    manablox.setControls({
      feature: async (_spaceId: string | null, key: string) => ({ enabled: !off.has(key) }),
    } as unknown as Controls);
    const lookup = manablox.plugin('consumer').plugins;
    expect(await lookup.isOn('provider', 'space-1')).toBe(false);
    expect(await lookup.isOn('consumer', 'space-1')).toBe(true);
    expect(await lookup.isOn('absent', null)).toBe(false);
  });
});

describe('extension points and contributions', () => {
  interface Greeter {
    word: string;
  }
  const target = definePlugin({
    name: 'target',
    extensionPoints: {
      greeters: extensionPoint<Greeter>({
        check: (entry, contributor) => {
          if (!entry.word) throw new Error(`${contributor}: a greeter needs a word`);
        },
      }),
    },
    contributions: { target: { greeters: [{ word: 'own' }] } },
  });
  const contributor = definePlugin({
    name: 'contributor',
    enhances: ['target', 'absent'],
    contributions: {
      target: { greeters: [{ word: 'hi' }, { word: 'hello' }] },
      absent: { things: [1] },
    },
  });
  const config = (...plugins: ManabloxPlugin[]) => ({
    database: { url: 'postgres://unused' },
    auth: { secret: 's' },
    logLevel: 'silent' as const,
    plugins,
  });

  it('hands the target every entry, tagged with its plugin, in boot order', () => {
    const manablox = started(new Manablox(config(contributor, target)));
    expect(manablox.plugin('target').contributions<Greeter>('greeters')).toEqual([
      { plugin: 'target', entry: { word: 'own' } },
      { plugin: 'contributor', entry: { word: 'hi' } },
      { plugin: 'contributor', entry: { word: 'hello' } },
    ]);
    expect(manablox.plugin('target').contributions('unknown')).toEqual([]);
  });

  it('gates entries by both plugins’ flags in a space', async () => {
    const manablox = started(new Manablox(config(contributor, target)));
    const off = new Set<string>();
    manablox.setControls({
      feature: async (_spaceId: string | null, key: string) => ({ enabled: !off.has(key) }),
    } as unknown as Controls);
    const context = manablox.plugin('target');
    expect(await context.contributions('greeters', 'space-1')).toHaveLength(3);
    off.add('plugins.contributor');
    expect(await context.contributions('greeters', 'space-1')).toEqual([
      { plugin: 'target', entry: { word: 'own' } },
    ]);
    off.add('plugins.target');
    expect(await context.contributions('greeters', 'space-1')).toEqual([]);
  });

  it('refuses entries to an undeclared point or that the point refuses', () => {
    const stray = definePlugin({ name: 'stray', contributions: { target: { unknown: [1] } } });
    expect(refusal(() => resolveConfig(config(target, stray)))).toEqual({
      key: 'plugin.contribution.unknown',
      params: { plugin: 'stray', target: 'target', point: 'unknown' },
    });
    const empty = definePlugin({
      name: 'empty',
      contributions: { target: { greeters: [{ word: '' }] } },
    });
    expect(() => resolveConfig(config(target, empty))).toThrow('empty: a greeter needs a word');
  });
});
