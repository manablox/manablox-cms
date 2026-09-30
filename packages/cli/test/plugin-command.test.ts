import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { managePlugins } from '../src/commands/plugins.js';
import { create } from '../src/create/index.js';
import { listedConfigured } from '../src/plugin/list.js';
import { FIRST_PARTY_PLUGINS } from '../src/plugins.js';
import { plugins } from './helpers/create.js';
import { scriptedPrompter } from './helpers/scripted-prompter.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-plugin-');

// Loading an instance's config reads its .env into process.env; later suites must not see it.
const env = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});
const ALL = FIRST_PARTY_PLUGINS.map((plugin) => plugin.id);

/** A new instance in a fresh folder, written as `manablox create` writes it. */
async function instance(options: Record<string, string>): Promise<string> {
  const cwd = tempDir();
  const out = new PassThrough();
  out.resume();
  const code = await create(
    { preset: 'local', 'admin-port': '3010', ...options },
    { 'no-install': true, 'no-git': true },
    ['cms'],
    { cwd, prompter: null, out, cliVersion: '0.4.0', plugins: await plugins() },
  );
  expect(code).toBe(0);
  return join(cwd, 'cms');
}

/** Every file below `dir` and its content, with the generated secrets masked. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else
        out[relative(dir, path)] = readFileSync(path, 'utf8')
          .replace(/^([A-Z_]*(?:SECRET|PASSWORD))=.+$/gm, '$1=<secret>')
          .replace(/:\/\/(\w+):[^@\s]+@/g, '://$1:<secret>@');
    }
  };
  walk(dir);
  return out;
}

/** Runs `manablox plugin ...` in `dir` without a terminal; no tool is run. */
async function plugin(
  dir: string,
  argv: string[],
  prompter = null as ReturnType<typeof scriptedPrompter> | null,
) {
  let out = '';
  let err = '';
  const ran: string[] = [];
  // Parsed with the first-party plugins' options, as `main` does for `plugin install`.
  const code = await managePlugins(parseArgs(['plugin', ...argv], await plugins()), {
    cwd: dir,
    prompter,
    tty: false,
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
    cliVersion: '0.4.0',
    run: async (command, args) => {
      ran.push([command, ...args].join(' '));
      return { code: 0, output: '' };
    },
  });
  return { code, out, err, ran };
}

describe('manablox plugin install and uninstall', () => {
  for (const preset of [
    { preset: 'local' },
    { preset: 'docker', proxy: 'caddy' },
    { preset: 'docker', proxy: 'nginx', database: 'sqlite', 'no-public': '' },
  ]) {
    it(`gives back exactly what create writes (${Object.values(preset).join(' ')})`, async () => {
      const options = Object.fromEntries(
        Object.entries(preset).filter(([name]) => !name.startsWith('no-')),
      );
      const flags = Object.keys(preset).filter((name) => name.startsWith('no-'));
      const make = async (features: string) => {
        const cwd = tempDir();
        const out = new PassThrough();
        out.resume();
        const all = Object.fromEntries(flags.map((flag) => [flag, true]));
        await create(
          { ...options, features },
          { 'no-install': true, 'no-git': true, ...all },
          ['cms'],
          { cwd, prompter: null, out, cliVersion: '0.4.0', plugins: await plugins() },
        );
        return join(cwd, 'cms');
      };
      const full = await make(ALL.join(','));
      const expected = snapshot(full);
      const core = snapshot(await make('none'));

      for (const id of ALL) {
        const result = await plugin(full, ['uninstall', id, '--yes', '--no-install']);
        expect(result.code, result.err).toBe(0);
        expect(result.out).toContain(`Its data stays: its tables and the ext.${id} values`);
      }
      // Without any feature the instance is the core alone again, anchors and all.
      expect(snapshot(full)).toEqual(core);

      for (const id of ALL) {
        const result = await plugin(full, ['install', id, '--no-install', '--no-migrate']);
        expect(result.code, result.err).toBe(0);
        expect(result.err).toBe('');
        expect(result.ran).toEqual([]);
      }
      expect(snapshot(full)).toEqual(expected);
    });
  }

  it('says so for a plugin that is installed or not installed already', async () => {
    const dir = await instance({ features: 'ai' });
    const again = await plugin(dir, ['install', 'ai', '--no-install', '--no-migrate']);
    expect(again.out).toContain('the ai plugin is installed already');
    expect(again.out).not.toContain('Next steps');
    const gone = await plugin(dir, ['uninstall', 'webhooks', '--yes']);
    expect(gone).toMatchObject({ code: 0, ran: [] });
    expect(gone.out).toContain('the webhooks plugin is not installed');
  });

  it('installs the license plugin with a premium plugin, and only once', async () => {
    const dir = await instance({ features: 'none' });
    const result = await plugin(dir, ['install', 'ai', '--no-install', '--no-migrate']);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain('installing the license plugin too; ai requires it');
    expect(result.out).toContain('installed the license plugin (@manablox/plugin-license@^0.4.0)');
    expect(result.out).toContain('installed the ai plugin');
    const plugins = readFileSync(join(dir, 'manablox.plugins.ts'), 'utf8');
    expect(plugins.indexOf('licensePlugin()')).toBeGreaterThan(-1);
    expect(plugins.indexOf('licensePlugin()')).toBeLessThan(plugins.indexOf('aiPlugin('));
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('\nMANABLOX_LICENSE_KEYS=\n');

    const website = await plugin(dir, ['install', 'website', '--no-install', '--no-migrate']);
    expect(website.out).not.toContain('installing the license plugin too');
    // A premium plugin picked in create brings it as well.
    const created = readFileSync(
      join(await instance({ features: 'website' }), 'manablox.plugins.ts'),
      'utf8',
    );
    expect(created).toContain('licensePlugin()');
  });

  it('runs the package manager of the instance and names the next steps', async () => {
    const dir = await instance({ preset: 'docker', proxy: 'caddy' });
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    const result = await plugin(dir, ['install', 'workflows', '--no-migrate']);
    expect(result.code, result.err).toBe(0);
    expect(result.ran).toEqual(['npm install']);
    expect(result.out).toContain('./scripts/lockfile.sh');
    expect(result.out).toContain('docker compose up -d --build');
    const removed = await plugin(dir, ['uninstall', 'workflows', '--yes']);
    expect(removed.ran).toEqual(['npm install']);
    expect(
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies,
    ).not.toHaveProperty('@manablox/plugin-workflows');
  });

  it('asks the plugin its install questions and to confirm an uninstall', async () => {
    const dir = await instance({});
    const asked = scriptedPrompter(['3301', 'development']);
    expect(
      (await plugin(dir, ['install', 'website', '--no-install', '--no-migrate'], asked)).code,
    ).toBe(0);
    expect(asked.asked()).toEqual([
      'Port of the site process',
      'Website is a premium plugin. On this local instance it runs without a license key; production needs a subscription. License it now?',
    ]);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('\nSITE_PORT=3301\n');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('## Designed sites');

    const declined = await plugin(
      dir,
      ['uninstall', 'website', '--no-install'],
      scriptedPrompter(['n']),
    );
    expect(declined.out).toContain('nothing was uninstalled');
    expect(existsSync(join(dir, 'manablox.site.config.ts'))).toBe(true);
    const headless = await plugin(dir, ['uninstall', 'website']);
    expect(headless.code).toBe(1);
    expect(headless.err).toContain('pass --yes without a terminal');
    const confirmed = await plugin(
      dir,
      ['uninstall', 'website', '--no-install'],
      scriptedPrompter(['y']),
    );
    expect(confirmed.code).toBe(0);
    expect(existsSync(join(dir, 'manablox.site.config.ts'))).toBe(false);
  });

  it("takes a plugin's create options without asking, and refuses others", async () => {
    const dir = await instance({});
    const asked = scriptedPrompter(['development']);
    const given = await plugin(
      dir,
      ['install', 'website', '--site-port', '3302', '--no-install', '--no-migrate'],
      asked,
    );
    expect(given.code, given.err).toBe(0);
    // Only the license question: the site port was given.
    expect(asked.asked()).toEqual([
      'Website is a premium plugin. On this local instance it runs without a license key; production needs a subscription. License it now?',
    ]);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('\nSITE_PORT=3302\n');

    const other = await instance({});
    const stray = await plugin(other, ['install', 'ai', '--site-port', '3302', '--no-install']);
    expect(stray.code).toBe(1);
    expect(stray.err).toContain('--site-port belongs to none of the plugins being installed (ai)');
    await expect(
      plugin(other, ['install', 'website', '--site-port', 'x', '--no-install']),
    ).rejects.toThrow(/site-port/);
    await expect(
      plugin(other, ['install', 'website', '--space-theme', 'bold', '--no-install']),
    ).rejects.toThrow('--space-theme is about the first space of manablox create');
  });

  it('prints the part for a file without its anchor and writes nothing to it', async () => {
    const dir = await instance({});
    const file = join(dir, 'manablox.plugins.ts');
    // An older or hand-edited plugins file.
    const edited = readFileSync(file, 'utf8').replace('  // manablox:slot config.plugins\n', '');
    writeFileSync(file, edited);
    const result = await plugin(dir, ['install', 'ai', '--no-install', '--no-migrate']);
    expect(result.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(edited);
    expect(result.err).toContain(
      "manablox.plugins.ts has no anchor 'manablox:slot config.plugins'; nothing was written to manablox.plugins.ts",
    );
    expect(result.err).toContain("aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),");
    // The files with their anchors got their parts all the same.
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('AI_ALLOWED_HOSTS=');

    const strict = await instance({});
    writeFileSync(join(strict, 'manablox.plugins.ts'), 'export const plugins = [];\n');
    const refused = await plugin(strict, [
      'install',
      'ai',
      '--no-install',
      '--no-migrate',
      '--strict',
    ]);
    expect(refused.code).toBe(1);
    expect(readFileSync(join(strict, 'manablox.plugins.ts'), 'utf8')).toBe(
      'export const plugins = [];\n',
    );
  });

  it('refuses a plugin whose required plugin is missing, and to uninstall a required one', async () => {
    const dir = await instance({ features: 'ai' });
    // A package the instance has, but not configured yet.
    const pkg = join(dir, 'node_modules/acme-seo');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'acme-seo',
        version: '1.0.0',
        manablox: { plugin: 'acme-seo', requires: ['workflows'] },
      }),
    );
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    manifest.dependencies['acme-seo'] = '^1.0.0';
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const refused = await plugin(dir, ['install', 'acme-seo', '--no-install', '--no-migrate']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      'the acme-seo plugin requires workflows; install it too: manablox plugin install workflows acme-seo',
    );
    // Not in node_modules and --no-install: nothing can say what it is.
    const unknown = await plugin(dir, ['install', 'acme-other', '--no-install']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain(
      'acme-other is not installed; without --no-install it is added and read first',
    );

    // The ai plugin cannot go while acme-seo needs it.
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'acme-seo',
        version: '1.0.0',
        manablox: { plugin: 'acme-seo', requires: ['ai'] },
      }),
    );
    const kept = await plugin(dir, ['uninstall', 'ai', '--yes', '--no-install']);
    expect(kept.code).toBe(1);
    expect(kept.err).toContain('the acme-seo plugin requires ai; uninstall it first');
    expect(readFileSync(join(dir, 'manablox.plugins.ts'), 'utf8')).toContain('aiPlugin(');
  });

  it('lists the plugins without a database', async () => {
    const dir = await instance({ features: 'workflows' });
    const listed = await plugin(dir, ['list']);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(
      /^plugin +package +installed +configured +migrations +instance flag +premium +license$/m,
    );
    expect(listed.out).toMatch(/^workflows +@manablox\/plugin-workflows +yes +yes +\? +\? +- +-$/m);
    expect(listed.out).toMatch(/^ai +@manablox\/plugin-ai +no +no +\? +\? +ai +-$/m);
    expect(listed.out).toContain('Available: manablox plugin install <id>');
    expect(listed.out).toContain('Migrations and flags are unknown:');
  });

  it('lists configured feature plugins, not library plugins such as the fields', () => {
    const id = (name: string) => name.replace(/^@/, '').replace(/\//g, '.');
    const manifest = {
      dependencies: {
        '@manablox/fields': '^0.26.0',
        '@manablox/plugin-ai': '^0.26.0',
        '@acme/seo': '^1.0.0',
      },
    };
    const installed = [
      { id: 'ai', name: 'ai', package: '@manablox/plugin-ai', range: '', cli: null, requires: [] },
      {
        id: 'acme.seo',
        name: '@acme/seo',
        package: '@acme/seo',
        range: '',
        cli: null,
        requires: [],
      },
    ];
    const configured = [
      { name: '@manablox/fields' },
      { name: 'ai' },
      { name: '@acme/seo' },
      // Defined in the instance's own code: no dependency, so it stays.
      { name: 'local-greetings' },
    ];
    expect(listedConfigured(configured, manifest, installed, id)).toEqual([
      'ai',
      'acme.seo',
      'local-greetings',
    ]);
  });

  it('refuses an unknown action', async () => {
    const result = await plugin(tempDir(), ['purge', 'ai']);
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "unknown plugin action 'purge'; one of list, install, uninstall, enable, disable",
    );
  });
});
