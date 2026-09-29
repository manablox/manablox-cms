import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ManabloxPlugin, pluginId } from '@manablox/core';
import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { pluginCommand } from '../src/commands/plugin.js';
import {
  type CliPlugin,
  configPlugins,
  FIRST_PARTY_PLUGINS,
  firstPartyPlugins,
  importContribution,
  installPlugins,
  packagePlugins,
  pluginCacheDir,
} from '../src/plugins.js';
import { spaceOptionsFromArgs } from '../src/space/options.js';
import { pluginSpaceData } from '../src/space/plugins.js';
import { usage } from '../src/usage.js';
import { plugins } from './helpers/create.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-plugins-');
const fixture = join(import.meta.dirname, 'fixtures/acme-cli.ts');

async function acme(): Promise<CliPlugin> {
  return { id: 'acme', name: 'acme', contribution: await importContribution(fixture) };
}

describe('CLI contributions: loading', () => {
  /** An installed dependency of the instance in `dir` that declares a CLI module. */
  const declare = (dir: string, name: string, plugin: string) => {
    const manifest = join(dir, 'package.json');
    const deps = existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, 'utf8')).dependencies as Record<string, string>)
      : {};
    writeFileSync(manifest, JSON.stringify({ dependencies: { ...deps, [name]: '1' } }));
    const pkg = join(dir, 'node_modules', name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name, manablox: { plugin, cli: fixture } }),
    );
  };

  it("loads the contributions the config's plugins declare in their package, once per plugin", async () => {
    const dir = tempDir();
    declare(dir, 'acme-plugin', 'acme');
    declare(dir, 'unused-plugin', 'unused');
    writeFileSync(
      join(dir, 'manablox.config.ts'),
      [
        "const acme = { name: 'acme' };",
        "export default { plugins: [acme, { name: 'plain' }, acme] };",
      ].join('\n'),
    );
    const loaded = await configPlugins(undefined, dir);
    expect(loaded.map((plugin) => [plugin.id, plugin.contribution.summary])).toEqual([
      ['acme', 'acme things'],
    ]);
  });

  it("lets a plugin's own cli win over its package's declaration", async () => {
    const dir = tempDir();
    declare(dir, 'acme-plugin', 'acme');
    const own = join(dir, 'own-cli.mjs');
    writeFileSync(own, "export default { summary: 'from the plugin object' };");
    writeFileSync(
      join(dir, 'manablox.config.ts'),
      `export default { plugins: [{ name: 'acme', cli: ${JSON.stringify(pathToFileURL(own).href)} }] };`,
    );
    const loaded = await configPlugins(undefined, dir);
    expect(loaded.map((plugin) => [plugin.id, plugin.contribution.summary])).toEqual([
      ['acme', 'from the plugin object'],
    ]);
    // The help reads package.json only, without the config.
    expect((await packagePlugins(dir)).map((plugin) => plugin.contribution.summary)).toEqual([
      'acme things',
    ]);
  });

  it('refuses a plugin named like a core command, and leaves it out of the help', async () => {
    const dir = tempDir();
    declare(dir, 'sync', 'sync');
    writeFileSync(
      join(dir, 'manablox.config.ts'),
      "export default { plugins: [{ name: 'Sync' }] };",
    );
    await expect(configPlugins(undefined, dir)).rejects.toThrow(
      "the plugin Sync has the id 'sync', which is a manablox command; rename the plugin",
    );
    expect(await packagePlugins(dir)).toEqual([]);
  });

  it('resolves a module id from the instance first', async () => {
    const dir = tempDir();
    const pkg = join(dir, 'node_modules/acme-plugin');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'acme-plugin', type: 'module', exports: { './cli': './cli.mjs' } }),
    );
    writeFileSync(join(pkg, 'cli.mjs'), "export default { summary: 'from the instance' };");
    expect((await importContribution('acme-plugin/cli', [dir])).summary).toBe('from the instance');
    await expect(importContribution('acme-missing/cli', [dir])).rejects.toThrow(
      /cannot find the CLI module acme-missing\/cli/,
    );
    writeFileSync(join(pkg, 'bad.mjs'), 'export default 1;');
    await expect(importContribution(join(pkg, 'bad.mjs'))).rejects.toThrow(
      /must export a defineCliContribution\(\) object/,
    );
  });

  it('knows the first-party plugins, none picked by default', async () => {
    expect(FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, plugin.default])).toEqual([
      ['website', false],
      ['ai', false],
      ['workflows', false],
      ['webhooks', false],
      ['license', false],
    ]);
    // Loaded by package name, in the catalogue's order; the premium ones from npm.
    expect((await plugins()).map((plugin) => plugin.id)).toEqual(
      FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
    );
  });
});

describe('CLI contributions: a local plugin', () => {
  // An instance whose plugin lives in its repository, without a package.json of its own.
  const instance = join(import.meta.dirname, 'fixtures/local-instance');

  it('loads the module the plugin names in the config, and runs its command', async () => {
    const [greeter, ...rest] = await configPlugins(undefined, instance);
    expect(rest).toEqual([]);
    expect(greeter).toMatchObject({
      id: 'greeter',
      name: 'greeter',
      contribution: { summary: 'greetings from the instance repository' },
    });
    const plugin = greeter as CliPlugin;
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      expect(await pluginCommand(parseArgs(['greeter', 'wave', 'Ann'], [plugin]), plugin)).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
    expect(writes).toEqual(['*waves at Ann*\n']);
    expect(usage({ instance: [plugin] })).toContain('manablox greeter <command> [options]\n');
  });

  it('stays out of the help without the config', async () => {
    expect(await packagePlugins(instance)).toEqual([]);
  });
});

describe('CLI contributions: first-party plugins', () => {
  /** The package.json of an installed package, found from its entry. */
  const manifestOf = (name: string) => {
    let dir = dirname(createRequire(import.meta.url).resolve(name));
    while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      manablox?: { plugin?: string; cli?: string };
    };
  };

  it('declares every contribution in package.json, where the CLI reads it', async () => {
    // The premium plugins live in their own repositories, which check the same of theirs.
    for (const plugin of FIRST_PARTY_PLUGINS.filter((entry) => !entry.premium)) {
      // The manifest names the plugin and its CLI module; `manablox create` knows the same.
      expect(manifestOf(plugin.package).manablox).toEqual({ plugin: plugin.id, cli: plugin.cli });
      // configPlugins pairs a configured plugin with its package by the plugin's id; the
      // plugin object's own `cli` (for local plugins) stays unset so the help sees the same.
      const exports = (await import(plugin.package)) as Record<string, unknown>;
      const factory = exports[`${plugin.id}Plugin`] as () => ManabloxPlugin;
      expect(pluginId(factory().name)).toBe(plugin.id);
      expect(factory().cli, plugin.id).toBeUndefined();
      const contribution = await importContribution(plugin.cli);
      expect(contribution, plugin.id).toBeTypeOf('object');
    }
  });

  const fake = {
    id: 'fake',
    package: '@acme/fake-plugin-missing',
    cli: '@acme/fake-plugin-missing/cli',
    label: 'Fake',
    hint: 'never published',
    default: false,
    enhances: [],
    requires: [],
  };
  const other = {
    ...fake,
    id: 'other',
    package: '@acme/other-missing',
    cli: '@acme/other-missing/cli',
  };

  it('leaves out a plugin that is not installed, unless asked to install it', async () => {
    const dir = tempDir();
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(dir, 'cache');
    try {
      expect(await firstPartyPlugins(dir, {}, [fake])).toEqual([]);
      expect(pluginCacheDir('1.2.3')).toBe(join(dir, 'cache/manablox/plugins/cli-1.2.3'));
      // Not asked for: never installed.
      expect(await firstPartyPlugins(dir, { install: ['other'] }, [fake])).toEqual([]);
      const told: string[][] = [];
      const failed = firstPartyPlugins(
        dir,
        { install: ['fake', 'other'], onInstall: (specs) => told.push([...specs]) },
        [fake, other],
      );
      await expect(failed).rejects.toThrow(
        /installing @acme\/fake-plugin-missing@\S+ @acme\/other-missing@\S+ failed: [\s\S]*pnpm dlx --package @manablox\/cli@\S+ --package @acme\/fake-plugin-missing@\S+ --package @acme\/other-missing@/,
      );
      // One npm run for both.
      expect(told).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previous;
    }
  }, 120_000);

  it('installs a plugin with npm into a folder it then resolves from', async () => {
    const dir = tempDir();
    const pkg = join(dir, 'fake-plugin');
    mkdirSync(pkg);
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'fake-cli-plugin',
        version: '1.0.0',
        type: 'module',
        exports: { './cli': './cli.mjs' },
      }),
    );
    writeFileSync(join(pkg, 'cli.mjs'), "export default { summary: 'installed' };");
    const cache = join(dir, 'cache');
    await installPlugins([`file:${pkg}`], cache);
    expect((await importContribution('fake-cli-plugin/cli', [cache])).summary).toBe('installed');
  }, 120_000);

  it("finds what the instance's packages declare, without the config", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'acme-plugin': '1' } }),
    );
    const pkg = join(dir, 'node_modules/acme-plugin');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'acme-plugin',
        type: 'module',
        exports: { './cli': './cli.mjs' },
        manablox: { plugin: '@acme/Plugin', cli: 'acme-plugin/cli' },
      }),
    );
    writeFileSync(join(pkg, 'cli.mjs'), "export default { summary: 'declared' };");
    const found = await packagePlugins(dir);
    expect(found.map((plugin) => [plugin.id, plugin.name, plugin.contribution.summary])).toEqual([
      ['acme.plugin', '@acme/Plugin', 'declared'],
    ]);
    expect(await packagePlugins(join(dir, 'node_modules'))).toEqual([]);
  });
});

describe('CLI contributions: options', () => {
  it("parses a plugin's space create options and turns them into its data", async () => {
    const plugin = await acme();
    const args = parseArgs(
      ['space', 'create', '--name', 'Blog', '--acme-mood', 'calm', '--no-acme-loud'],
      [plugin],
    );
    expect(args.options['acme-mood']).toBe('calm');
    const options = spaceOptionsFromArgs(args.options, args.flags, args.lists);
    const valuesOf = () => ({ 'acme-mood': 'calm', 'acme-loud': false });
    const { plugins: data, reports } = await pluginSpaceData(options, [plugin], valuesOf);
    expect(data).toEqual({ acme: { mood: 'calm', for: 'blog' } });
    expect(reports[0]?.({ url: 'http://x', warnings: [] })).toEqual(['acme mood calm']);
    await expect(
      pluginSpaceData(options, [plugin], () => ({ 'acme-mood': 'grumpy' })),
    ).rejects.toThrow(/cannot be grumpy/);
    await expect(
      pluginSpaceData({ ...options, pluginData: { acme: 1 } }, [plugin], valuesOf),
    ).rejects.toThrow(
      "--acme-mood, --acme-loud and --plugin-data acme=... both give the acme plugin's data",
    );
    expect(() => parseArgs(['space', 'create', '--acme-mood', 'calm'])).toThrow(
      /unknown option '--acme-mood' for 'space'/,
    );
  });

  it('refuses a plugin option that another owner has', async () => {
    const plugin = await acme();
    const clash: CliPlugin = {
      id: 'clash',
      name: 'clash',
      contribution: {
        summary: 'clash',
        options: { 'space create': { options: [{ name: 'name', help: 'x' }], apply: () => 1 } },
      },
    };
    expect(() => parseArgs(['space', 'create'], [plugin, clash])).toThrow(
      "the clash plugin adds --name to 'space', which the core has already",
    );
    const twin: CliPlugin = { ...plugin, id: 'twin' };
    expect(() => parseArgs(['space', 'create'], [plugin, twin])).toThrow(
      "the twin plugin adds --acme-mood to 'space', which the acme plugin has already",
    );
  });
});

describe('CLI contributions: commands', () => {
  it('runs the longest matching command with its options and positionals', async () => {
    const plugin = await acme();
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const run = (argv: string[]) => pluginCommand(parseArgs(argv, [plugin]), plugin);
      expect(await run(['acme', 'hello', 'a', 'b', '--to', 'Ann'])).toBe(0);
      expect(await run(['acme', 'hello', 'twice', 'Bo'])).toBe(3);
      expect(writes).toEqual(['hello Ann a,b\n', 'hello hello Bo\n']);
      await expect(run(['acme', 'hello', 'twice', 'Bo', '--to', 'x'])).rejects.toThrow(
        "unknown option '--to' for 'acme hello twice'",
      );
    } finally {
      vi.restoreAllMocks();
    }
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    try {
      expect(await pluginCommand(parseArgs(['acme', 'bye'], [plugin]), plugin)).toBe(1);
      expect(errors.join('')).toContain("unknown acme command 'bye'; one of hello, hello twice");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('CLI contributions: help', () => {
  it('lists the plugin options and commands grouped per plugin', async () => {
    const [website] = await plugins();
    const plugin = await acme();
    const text = usage({ create: website ? [website] : [], instance: [plugin] });
    expect(text).toContain('  acme         the acme plugin (see below)\n');
    expect(text).toContain('  The website plugin: designed websites, served by the site process\n');
    expect(text).toContain('  --website / --no-website    include the plugin (default: no)\n');
    expect(text).toContain('  --features <list>           the features, comma separated');
    expect(text).toContain('manablox plugin <command> [options]\n');
    expect(text).toMatch(/\n {2}--space-website designed\|external\n {30}designed: a theme/);
    expect(text).toContain('  --site-port <port>          without a proxy: the site process port');
    expect(text).toContain(
      '  The acme plugin: acme things\n  --acme-mood <mood>          the mood',
    );
    expect(text).toContain('  --acme-loud / --no-acme-loud\n');
    expect(text).toContain('manablox acme <command> [options]\n');
    expect(text).toContain('  hello twice <name>          say hello twice\n');
    expect(text).not.toContain('--site / --no-site');
    // Plugin help is wrapped to the core's width.
    const pluginLines = text.split('\n').filter((line) => /acme|site/.test(line));
    for (const line of pluginLines) expect(line.length, line).toBeLessThanOrEqual(90);
  });

  it('shows no plugin sections without plugins', () => {
    const text = usage();
    expect(text).not.toContain('plugin: ');
    expect(text).toContain('  --plan <file>               a JSON content type plan');
  });
});
