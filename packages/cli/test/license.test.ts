import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { CliContribution } from '@manablox/core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { logsOnStderr, pluginCommand } from '../src/commands/plugin.js';
import { managePlugins } from '../src/commands/plugins.js';
import { create } from '../src/create/index.js';
import { developmentSetup, premiumProducts, premiumPrompt, uncovered } from '../src/license.js';
import { browserCommand, type OpenEnvironment, openUrl } from '../src/open.js';
import type { CliPlugin } from '../src/plugins.js';
import type { Prompter } from '../src/ui.js';
import { plugins } from './helpers/create.js';
import { scriptedPrompter } from './helpers/scripted-prompter.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-license-');

/** A key with a valid checksum; no license server is asked about it. */
const KEY = 'MBX-0KB84-X6NY9-NT3YS-1QQPF-Z5NEB';
const PREMIUM = 'AI is a premium plugin. License it now?';
/** The question on a local instance, where the premium plugins run without a key. */
const PREMIUM_LOCAL =
  'AI is a premium plugin. On this local instance it runs without a license key; production needs a subscription. License it now?';

const env = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

describe('openUrl', () => {
  const found = (platform: NodeJS.Platform, procVersion = '', onPath = false) =>
    browserCommand('https://licenses.test/cli/AB?x=1&y=2', {
      platform,
      procVersion: () => procVersion,
      onPath: () => onPath,
    });

  it('picks the command of each platform, and WSL by /proc/version', () => {
    expect(found('darwin')).toEqual(['open', ['https://licenses.test/cli/AB?x=1&y=2']]);
    expect(found('win32')).toEqual([
      'cmd',
      ['/c', 'start', '', 'https://licenses.test/cli/AB?x=1^&y=2'],
    ]);
    expect(found('linux', 'Linux version 6.1 (gcc)')).toEqual([
      'xdg-open',
      ['https://licenses.test/cli/AB?x=1&y=2'],
    ]);
    const wsl = 'Linux version 5.15.153.1-microsoft-standard-WSL2';
    expect(found('linux', wsl, true)).toEqual([
      'wslview',
      ['https://licenses.test/cli/AB?x=1&y=2'],
    ]);
    expect(found('linux', wsl, false)).toEqual([
      'cmd.exe',
      ['/c', 'start', '', 'https://licenses.test/cli/AB?x=1^&y=2'],
    ]);
  });

  /** Runs `openUrl` with a fake spawn that fails when `fails` is set. */
  async function open(environment: Partial<OpenEnvironment>, browser?: boolean, fails = false) {
    let out = '';
    const spawned: string[][] = [];
    const opened = await openUrl('https://licenses.test/x', {
      out: { write: (text: string) => (out += text) },
      ...(browser === undefined ? {} : { browser }),
      environment: {
        platform: 'darwin',
        env: {},
        tty: true,
        spawn: (command, args) => {
          spawned.push([command, ...args]);
          return {
            on: (_event, listener) => (fails ? queueMicrotask(listener) : undefined),
            unref: () => undefined,
          };
        },
        ...environment,
      },
    });
    return { opened, out, spawned };
  }

  it('opens detached and always prints the address', async () => {
    const result = await open({});
    expect(result).toMatchObject({ opened: true, spawned: [['open', 'https://licenses.test/x']] });
    expect(result.out).toContain('https://licenses.test/x');
  });

  it('only prints with --no-browser, without a terminal and over SSH', async () => {
    for (const run of [
      await open({}, false),
      await open({ tty: false }),
      await open({ env: { SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22' } }),
    ]) {
      expect(run.spawned).toEqual([]);
      expect(run.out).toBe('Open this address in a browser:\n  https://licenses.test/x\n');
    }
  });

  it('never throws: a browser that does not start leaves the address', async () => {
    const failed = await open({}, true, true);
    expect(failed.opened).toBe(false);
    expect(failed.out).toContain('No browser opened; open the address yourself:');
    const thrown = await open({
      spawn: () => {
        throw new Error('ENOENT');
      },
    });
    expect(thrown.opened).toBe(false);
  });
});

describe('plugin commands: the context', () => {
  const plugin = (contribution: CliContribution): CliPlugin => ({
    id: 'probe',
    name: 'probe',
    contribution,
  });

  it('accepts --yes and the license options, and refuses the rest', async () => {
    const license = (await plugins()).find((entry) => entry.id === 'license');
    if (!license) throw new Error('the license plugin is not loaded');
    const args = parseArgs(
      ['license', 'add', KEY, '--dev', '--name', 'Main', '--no-activate', '--yes'],
      [license],
    );
    expect(args).toMatchObject({
      command: 'license',
      positionals: ['add', KEY],
      options: { name: 'Main' },
      flags: { dev: true, 'no-activate': true, yes: true },
    });
    const buy = parseArgs(
      ['license', 'buy', '--plugins', 'ai,website', '--yearly', '--no-browser'],
      [license],
    );
    expect(buy).toMatchObject({
      options: { plugins: 'ai,website' },
      flags: { yearly: true, 'no-browser': true },
    });
    expect(() => parseArgs(['license', 'buy', '--seats', '2'], [license])).toThrow(
      "unknown option '--seats' for 'license'",
    );
    await expect(
      pluginCommand(parseArgs(['license', 'status', '--dev'], [license]), license),
    ).rejects.toThrow("unknown option '--dev' for 'license status'");
  });

  it('hands the command its folder, no prompter with --yes, and aborts on Ctrl-C', async () => {
    const seen: Record<string, unknown> = {};
    const probe = plugin({
      summary: 'probe',
      commands: {
        wait: {
          description: 'waits for Ctrl-C',
          run: async (context) => {
            seen.cwd = context.cwd;
            seen.prompter = context.prompter;
            const { signal } = context;
            process.emit('SIGINT');
            seen.aborted = signal.aborted;
            await context.spin(
              'working',
              async () => 1,
              (value) => `done ${value}`,
            );
            return 0;
          },
        },
      },
    });
    let out = '';
    const code = await pluginCommand(parseArgs(['probe', 'wait', '--yes'], [probe]), probe, {
      cwd: '/srv/cms',
      out: { write: (text: string) => (out += text) },
      tty: false,
    });
    expect(code).toBe(0);
    expect(seen).toEqual({ cwd: '/srv/cms', prompter: null, aborted: true });
    expect(out).toBe('working\ndone 1\n');
    // The listener is gone once the command ends.
    expect(process.listenerCount('SIGINT')).toBe(0);
  });
});

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

async function install(dir: string, argv: string[], prompter: Prompter | null = null) {
  let out = '';
  let err = '';
  const code = await managePlugins(parseArgs(['plugin', 'install', ...argv], await plugins()), {
    cwd: dir,
    prompter,
    tty: false,
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
    cliVersion: '0.4.0',
    run: async () => ({ code: 0, output: '' }),
  });
  return { code, out, err };
}

const dotEnv = (dir: string) => readFileSync(join(dir, '.env'), 'utf8');

describe('the instance a plugin command boots', () => {
  it('logs to stderr, so stdout is the answer (license status --json)', () => {
    expect(logsOnStderr(undefined)).toEqual({
      adapters: [{ type: 'console', destination: 'stderr' }],
    });
    const file = { type: 'file', path: 'app.log' } as const;
    expect(
      logsOnStderr({ level: 'warn', adapters: [{ type: 'console', pretty: false }, file] }),
    ).toEqual({
      level: 'warn',
      adapters: [{ type: 'console', pretty: false, destination: 'stderr' }, file],
    });
  });
});

describe('manablox plugin install: the license prompt', () => {
  it('names the premium products of plugin ids', () => {
    expect(premiumProducts(['workflows', 'website', 'ai'])).toEqual(['website', 'ai']);
    expect(premiumProducts(['license', 'webhooks'])).toEqual([]);
  });

  it('prints the commands to run without a terminal, and installs anyway', async () => {
    const dir = await instance({ preset: 'docker' });
    const result = await install(dir, ['ai', '--no-install', '--no-migrate']);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(
      'AI is a premium plugin.\nAI stays locked until a license covers it:',
    );
    expect(result.out).toContain('manablox license buy --plugins ai --trial --monthly');
    expect(result.out).toContain('manablox license buy --plugins ai --monthly');
    expect(result.out).toContain('manablox license add <key>');
    expect(readFileSync(join(dir, 'manablox.plugins.ts'), 'utf8')).toContain('aiPlugin(');
  });

  it('asks once, and later leaves the plugin locked', async () => {
    const dir = await instance({ preset: 'docker' });
    const prompter = scriptedPrompter(['later']);
    const result = await install(dir, ['ai', '--no-install', '--no-migrate'], prompter);
    expect(result.code, result.err).toBe(0);
    expect(prompter.asked()).toEqual([PREMIUM]);
    expect(result.out).toContain('AI stays locked until a license covers it');
  });

  it('says a local instance runs it without a key, and leads with continuing so', async () => {
    const dir = await instance({});
    const prompter = scriptedPrompter(['']);
    const result = await install(dir, ['ai', '--no-install', '--no-migrate'], prompter);
    expect(result.code, result.err).toBe(0);
    expect(prompter.asked()).toEqual([PREMIUM_LOCAL]);
    expect(result.out).toContain(
      'AI runs here without a license key, on private hosts only. A production instance needs a subscription:\n  manablox license buy --plugins ai --trial --monthly',
    );
    expect(dotEnv(dir)).toContain('\nMANABLOX_LICENSE_KEYS=\n');
    // The license choices stay, after continuing without a key.
    let offered: unknown[] = [];
    const recording: Prompter = {
      ...scriptedPrompter([]),
      select: async (question) => {
        offered = question.options.map((option) => [option.value, option.label]);
        return question.initialValue as never;
      },
    };
    await premiumPrompt(['ai'], {
      cwd: dir,
      out: { write: () => true },
      err: { write: () => true },
      prompter: recording,
      tty: false,
      license: { id: 'license', name: 'license', contribution: { summary: '', commands: {} } },
      ready: false,
      development: true,
    });
    expect(offered).toEqual([
      ['development', 'Continue without a key (development)'],
      ['trial', 'Start a 14-day trial'],
      ['buy', 'Buy a subscription'],
      ['add', 'Enter a key I already have'],
    ]);
  });

  it('tells a development setup by its .env', () => {
    const dir = tempDir();
    const setup = (text: string, env: Record<string, string> = {}) => {
      writeFileSync(join(dir, '.env'), text);
      return developmentSetup(dir, env);
    };
    expect(setup('PUBLIC_URL=http://localhost:3000\nPUBLIC_API_URL=http://localhost:3100\n')).toBe(
      true,
    );
    expect(setup('PUBLIC_URL=https://cms.example.com\n')).toBe(false);
    expect(
      setup('PUBLIC_URL=https://cms.example.com\nMANABLOX_LICENSE_DEV_HOSTS=cms.example.com\n'),
    ).toBe(true);
    expect(setup('PUBLIC_URL=http://localhost:3000\nNODE_ENV=production\n')).toBe(false);
    expect(setup('PUBLIC_URL=http://localhost:3000\n', { NODE_ENV: 'production' })).toBe(false);
    expect(setup('PUBLIC_URL=http://localhost:3000\nMANABLOX_LICENSE_KIND=production\n')).toBe(
      false,
    );
    // The docker preset runs NODE_ENV=production in its compose file.
    expect(setup('ADMIN_DOMAIN=http://cms.localhost\nPUBLIC_URL=http://cms.localhost\n')).toBe(
      false,
    );
    expect(setup('')).toBe(false);
  });

  it('takes a key: into .env, activated when the instance starts', async () => {
    const dir = await instance({});
    const prompter = scriptedPrompter(['add', KEY]);
    const result = await install(dir, ['ai', '--no-install', '--no-migrate'], prompter);
    expect(result.code, result.err).toBe(0);
    expect(prompter.asked()).toEqual([PREMIUM_LOCAL, 'License key']);
    expect(dotEnv(dir)).toContain(`\nMANABLOX_LICENSE_KEYS=${KEY}\n`);
    expect(result.out).toContain('The instance activates it when it starts.');
  });

  it('asks a ready instance for its license states', async () => {
    const states: CliPlugin = {
      id: 'license',
      name: 'license',
      contribution: {
        summary: 'licenses',
        commands: {
          status: {
            description: 'states',
            run: async (context) => {
              expect(context.values).toEqual({ json: true });
              context.out.write(
                JSON.stringify({
                  products: [
                    { product: 'ai', state: 'active' },
                    { product: 'website', state: 'lapsed' },
                    { product: 'next', state: 'development' },
                  ],
                }),
              );
              return 1;
            },
          },
        },
      },
    };
    const setup = {
      cwd: tempDir(),
      out: { write: () => true },
      err: { write: () => true },
      prompter: null,
      tty: false,
      license: states,
      runtime: async () => ({ runtime: { plugin: {} as never }, shutdown: async () => {} }),
    };
    expect(await uncovered(['ai', 'website'], { ...setup, ready: true })).toEqual({
      products: ['website'],
      development: false,
    });
    // A development instance runs a product without a license: still asked, as development.
    const next = 'next' as 'ai';
    expect(await uncovered(['ai', next], { ...setup, ready: true })).toEqual({
      products: [next],
      development: true,
    });
    // Not migrated: only whether a key is configured at all, and the .env for development.
    expect(await uncovered(['ai', 'website'], { ...setup, ready: false }, {})).toEqual({
      products: ['ai', 'website'],
      development: false,
    });
    expect(
      await uncovered(['ai'], { ...setup, ready: false }, { MANABLOX_LICENSE_KEYS: KEY }),
    ).toEqual({ products: [], development: false });
  });

  it('hands the trial choice to buy as its trial hint, and buy without it', async () => {
    const values: Record<string, unknown>[] = [];
    const license: CliPlugin = {
      id: 'license',
      name: 'license',
      contribution: {
        summary: 'licenses',
        commands: {
          buy: {
            description: 'buy',
            run: async (context) => {
              values.push({ ...context.values });
              return 0;
            },
          },
        },
      },
    };
    const setup = (answer: string) => ({
      cwd: tempDir(),
      out: { write: () => true },
      err: { write: () => true },
      prompter: scriptedPrompter([answer]),
      tty: false,
      license,
      ready: false,
    });
    await premiumPrompt(['ai'], setup('trial'));
    await premiumPrompt(['ai', 'website'], setup('buy'));
    expect(values).toEqual([
      { activate: false, plugins: 'ai', trial: true },
      { activate: false, plugins: 'ai,website' },
    ]);
  });

  it('asks nothing when a key is configured', async () => {
    // The website brought the license plugin and its entry in .env.
    const dir = await instance({ features: 'website' });
    writeFileSync(
      join(dir, '.env'),
      dotEnv(dir).replace('MANABLOX_LICENSE_KEYS=\n', `MANABLOX_LICENSE_KEYS=${KEY}\n`),
    );
    const prompter = scriptedPrompter([]);
    const result = await install(dir, ['ai', '--no-install', '--no-migrate'], prompter);
    expect(result.code, result.err).toBe(0);
    expect(prompter.asked()).toEqual([]);
    expect(result.out).not.toContain('premium');
  });
});

describe('manablox create: the license prompt', () => {
  /** Takes every default, answers the license question with `answers`. */
  function defaults(answers: string[]): Prompter & { asked: string[] } {
    const asked: string[] = [];
    const scripted = scriptedPrompter(answers);
    return {
      asked,
      text: async (question) =>
        question.message === 'License key' ? scripted.text(question) : question.defaultValue,
      select: async (question) => {
        asked.push(question.message);
        return question.message === PREMIUM_LOCAL
          ? scripted.select(question)
          : question.initialValue;
      },
      multiselect: async (question) => [...(question.initialValues ?? [])],
      confirm: async (question) => question.initialValue,
      password: async () => 'correct-horse-battery',
    };
  }

  const run = async (prompter: Prompter | null) => {
    const cwd = tempDir();
    let text = '';
    const out = new PassThrough();
    out.on('data', (chunk) => (text += String(chunk)));
    const code = await create(
      { preset: 'local', 'admin-port': '3010', database: 'sqlite', features: 'ai' },
      { 'no-install': true, 'no-git': true, 'no-start': true, 'no-admin': true, 'no-space': true },
      ['cms'],
      { cwd, prompter, out, cliVersion: '0.4.0', plugins: await plugins() },
    );
    return { code, out: text, dir: join(cwd, 'cms') };
  };

  it('lists the license commands in the next steps without a terminal', async () => {
    const result = await run(null);
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      '# the premium plugins run locally without a key; production needs a license:',
    );
    expect(result.out).toContain('pnpm exec manablox license buy --plugins ai --trial --monthly');
  });

  it('continues without a key by default on the local preset', async () => {
    const prompter = defaults(['']);
    const result = await run(prompter);
    expect(result.code, result.out).toBe(0);
    expect(prompter.asked.filter((message) => message === PREMIUM_LOCAL)).toHaveLength(1);
    expect(result.out).toContain('AI runs here without a license key, on private hosts only.');
    expect(dotEnv(result.dir)).toContain('MANABLOX_LICENSE_KEYS=\n');
  });

  it('asks once at the end and writes the key to the new .env', async () => {
    const prompter = defaults(['add', KEY]);
    const result = await run(prompter);
    expect(result.code, result.out).toBe(0);
    expect(prompter.asked.filter((message) => message === PREMIUM_LOCAL)).toHaveLength(1);
    expect(dotEnv(result.dir)).toContain(`MANABLOX_LICENSE_KEYS=${KEY}\n`);
    expect(result.out).not.toContain('pnpm exec manablox license buy');
  });
});
