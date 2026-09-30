import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliCommandContext, CliPrompter, CliValues } from '@manablox/core';
import { keyId } from '@manablox/license';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activate,
  add,
  buy,
  type LicenseCliDeps,
  open,
  refresh,
  remove,
  status,
} from '../src/cli/commands.js';
import contribution from '../src/cli/index.js';
import { bootLicense, type LicenseInstance } from './helpers/boot.js';
import { FAKE_SERVER } from './helpers/fake-server.js';

let instance: LicenseInstance | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await instance?.close();
  instance = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot(kind: 'production' | 'auto' = 'production'): Promise<LicenseInstance> {
  instance = await bootLicense('cli', { license: () => ({ keys: [], kind }) });
  await instance.services().licenses.reconcile();
  return instance;
}

/** An instance folder, with a `.env` unless `env` is `null`. */
function folder(env: string | null = 'MANABLOX_LICENSE_KEYS=\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'manablox-license-cli-'));
  dirs.push(dir);
  if (env !== null) writeFileSync(join(dir, '.env'), env);
  return dir;
}

const dotEnv = (dir: string) => readFileSync(join(dir, '.env'), 'utf8');

/** Answers from a list: a select by value or label, a multiselect as `a,b`, a confirm as y. */
function scripted(answers: string[]): CliPrompter & { asked: string[] } {
  const asked: string[] = [];
  const next = (message: string) => {
    asked.push(message);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`no answer for: ${message}`);
    return answer;
  };
  return {
    asked,
    text: async ({ message }) => next(message),
    select: async ({ message, options }) => {
      const answer = next(message);
      const picked = options.find(
        (option) =>
          option.value === answer || option.label === answer || option.value.startsWith(answer),
      );
      if (!picked) throw new Error(`${answer} is not an option of ${message}`);
      return picked.value;
    },
    multiselect: async ({ message }) => next(message).split(',') as never,
    confirm: async ({ message }) => next(message) === 'y',
  };
}

interface Run {
  cwd: string;
  prompter?: CliPrompter | null;
  /** Called on each wait of the poll, with the abort of Ctrl-C. */
  onSleep?: (abort: () => void) => void;
  /** The runtime fails to boot, as an instance that is not set up. */
  noRuntime?: boolean;
  /** The shell's environment beside the license server. */
  env?: Record<string, string>;
}

/** Runs `manablox license <words>` against the booted instance and the fake server. */
async function license(target: LicenseInstance, argv: string[], values: CliValues, run: Run) {
  const [words = '', ...positionals] = argv;
  let out = '';
  let err = '';
  const opened: Array<{ url: string; browser: boolean | undefined }> = [];
  const controller = new AbortController();
  let booted = 0;
  const context: CliCommandContext = {
    positionals,
    values,
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
    cwd: run.cwd,
    prompter: run.prompter ?? null,
    signal: controller.signal,
    open: async (url, options) => {
      opened.push({ url, browser: options?.browser });
    },
    spin: (_label, work) => work(),
    runtime: async () => {
      booted += 1;
      if (run.noRuntime) throw new Error('the database is not migrated');
      return { plugin: target.api.manablox.plugin('license') } as never;
    },
  };
  const deps: LicenseCliDeps = {
    env: { MANABLOX_LICENSE_SERVER: FAKE_SERVER, ...run.env },
    fetch: target.server.fetch,
    now: () => target.clock.now,
    sleep: async (ms) => {
      target.clock.now += ms;
      run.onSleep?.(() => controller.abort());
    },
  };
  const commands = { activate, add, buy, open, refresh, remove, status };
  const command = commands[words as keyof typeof commands];
  const code = await command(context, deps);
  return { code, out, err, opened, booted: () => booted };
}

const rows = (target: LicenseInstance) => target.services().licenses.overview().keys;

describe('manablox license: the contribution', () => {
  it('describes every command, and loads their code only when one runs', () => {
    expect(Object.keys(contribution.commands ?? {})).toEqual([
      'buy',
      'add',
      'status',
      'activate',
      'refresh',
      'remove',
      'open',
    ]);
    const buy = contribution.commands?.buy?.options?.map((option) => option.name);
    expect(buy).toEqual(['plugins', 'yearly', 'monthly', 'trial', 'browser', 'activate']);
  });
});

describe('manablox license add', () => {
  it('writes the key to .env, activates it and says what it covers', async () => {
    const target = await boot();
    const key = target.server.addKey({ products: ['ai'] });
    const cwd = folder();
    const result = await license(target, ['add', key], { name: 'Main site' }, { cwd });
    expect(result.code, result.err).toBe(0);
    expect(dotEnv(cwd)).toBe(`MANABLOX_LICENSE_KEYS=${key}\n`);
    expect(result.out).toContain(`Added ${keyId(key)} to MANABLOX_LICENSE_KEYS in .env`);
    expect(result.out).toContain(`${keyId(key)} is active here as production: AI`);
    expect(result.out).toMatch(/the period ends \d{4}-\d{2}-\d{2}/);
    expect([...target.server.activations.values()][0]).toMatchObject({ name: 'Main site' });
    expect(target.services().entitlement('ai').state).toBe('active');

    // Again: nothing doubles, the activation stays.
    const again = await license(target, ['add', key.toLowerCase()], {}, { cwd });
    expect(again.code).toBe(0);
    expect(again.out).toContain('is in .env already');
    expect(dotEnv(cwd)).toBe(`MANABLOX_LICENSE_KEYS=${key}\n`);
    expect(target.server.activations.size).toBe(1);
  });

  it('activates as development with --dev, and appends to the keys there are', async () => {
    const target = await boot();
    const first = target.server.addKey();
    const key = target.server.addKey();
    const cwd = folder(`AUTH_SECRET=x\nMANABLOX_LICENSE_KEYS=${first}\n`);
    const result = await license(target, ['add', key], { dev: true }, { cwd });
    expect(result.code, result.err).toBe(0);
    expect(dotEnv(cwd)).toBe(`AUTH_SECRET=x\nMANABLOX_LICENSE_KEYS=${first},${key}\n`);
    expect(result.out).toContain('active here as development');
    const activation = [...target.server.activations.values()].find((entry) => entry.key === key);
    expect(activation?.kind).toBe('development');
    await expect(
      license(target, ['add', key], { dev: true, production: true }, { cwd }),
    ).rejects.toThrow('use --dev or --production, not both');
  });

  it('refuses a typo offline', async () => {
    const target = await boot();
    const cwd = folder();
    const result = await license(target, ['add', 'MBX-NOPE'], {}, { cwd });
    expect(result.code).toBe(1);
    expect(result.err).toContain('That is not a license key');
    expect(dotEnv(cwd)).toBe('MANABLOX_LICENSE_KEYS=\n');
    expect(result.booted()).toBe(0);
  });

  it('without .env prints the line, or creates the file when asked', async () => {
    const target = await boot();
    const key = target.server.addKey();
    const headless = folder(null);
    const printed = await license(target, ['add', key], {}, { cwd: headless });
    expect(printed.code).toBe(1);
    expect(printed.out).toContain(`  MANABLOX_LICENSE_KEYS=${key}`);
    expect(existsSync(join(headless, '.env'))).toBe(false);
    expect(printed.booted()).toBe(0);

    const asked = folder(null);
    const prompter = scripted(['create']);
    const created = await license(target, ['add', key], {}, { cwd: asked, prompter });
    expect(created.code, created.err).toBe(0);
    expect(prompter.asked).toEqual(['There is no .env here. Where should the key go?']);
    expect(dotEnv(asked)).toBe(`MANABLOX_LICENSE_KEYS=${key}\n`);
  });

  it('only writes .env with --no-activate, and without a booting instance', async () => {
    const target = await boot();
    const key = target.server.addKey();
    const cwd = folder();
    const later = await license(
      target,
      ['add', key],
      { activate: false },
      { cwd, noRuntime: true },
    );
    expect(later.code).toBe(0);
    expect(later.out).toContain('The instance activates it when it starts.');
    expect(later.booted()).toBe(0);

    const failed = await license(target, ['add', key], {}, { cwd, noRuntime: true });
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('the instance did not boot here: the database is not migrated');
  });

  it('warns when the shell sets the keys, which win over .env', async () => {
    const target = await boot();
    const key = target.server.addKey();
    const other = target.server.addKey();
    const cwd = folder();
    const quiet = await license(target, ['add', key], { activate: false }, { cwd });
    expect(quiet.err).toBe('');
    const shell = await license(
      target,
      ['add', other],
      { activate: false },
      {
        cwd,
        env: { MANABLOX_LICENSE_KEYS: key.replace('MBX', 'mbx') },
      },
    );
    expect(shell.err).toContain(
      `MANABLOX_LICENSE_KEYS is set in this shell too and wins over .env; add ${keyId(other)} there as well`,
    );
  });
});

describe('manablox license add: no free seat', () => {
  /** A key whose one production seat another instance holds. */
  async function taken(target: LicenseInstance) {
    const key = target.server.addKey({ quantity: 1 });
    const response = await target.server.fetch(`${FAKE_SERVER}/v1/activations`, {
      method: 'POST',
      body: JSON.stringify({
        key,
        instanceId: 'other-instance',
        kind: 'production',
        name: 'Old box',
      }),
    });
    const { activationId } = (await response.json()) as { activationId: string };
    return { key, holder: activationId };
  }

  it('lists the seat holders and what to run, without a terminal', async () => {
    const target = await boot();
    const { key } = await taken(target);
    const result = await license(target, ['add', key], {}, { cwd: folder() });
    expect(result.code).toBe(1);
    expect(result.err).toContain(`Every production seat of ${keyId(key)} is taken:`);
    expect(result.err).toContain('Old box');
    expect(result.err).toContain(`manablox license activate ${keyId(key)} --dev`);
  });

  it('frees the seat of another instance with the key, then activates here', async () => {
    const target = await boot();
    const { key, holder } = await taken(target);
    const prompter = scripted([`free:${holder}`]);
    const result = await license(target, ['add', key], {}, { cwd: folder(), prompter });
    expect(result.code, result.err).toBe(0);
    expect(target.server.activations.get(holder)?.deactivated).toBe(true);
    expect(target.server.calls.find((call) => call.method === 'DELETE')?.body).toEqual({ key });
    expect(result.out).toContain('active here as production');
  });

  it('activates as development instead, or leaves the key unactivated', async () => {
    const target = await boot();
    const { key } = await taken(target);
    const cancelled = await license(
      target,
      ['add', key],
      {},
      { cwd: folder(), prompter: scripted(['cancel']) },
    );
    expect(cancelled.code).toBe(1);
    expect(cancelled.err).toContain('is not activated');

    const dev = await license(
      target,
      ['add', key],
      {},
      { cwd: folder(), prompter: scripted(['development']) },
    );
    expect(dev.code, dev.err).toBe(0);
    expect(dev.out).toContain('active here as development');
  });
});

describe('manablox license status, activate, refresh, remove, open', () => {
  it('shows every key and product, with exit code 1 while one is locked', async () => {
    const target = await boot();
    const cwd = folder();
    const missing = await license(target, ['status'], {}, { cwd });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('No license keys');
    expect(missing.out).toMatch(/AI +missing, buy: https:\/\/licenses\.test\/buy\?products=ai/);

    const key = target.server.addKey({ products: ['ai'] });
    await license(target, ['add', key], {}, { cwd });
    const active = await license(target, ['status'], {}, { cwd });
    expect(active.code).toBe(0);
    expect(active.out).toMatch(
      /^key +source +products +kind +state +period end +lease until +refreshed$/m,
    );
    expect(active.out).toMatch(new RegExp(`^${keyId(key)} +env +ai +production +active `, 'm'));
    const json = await license(target, ['status'], { json: true }, { cwd });
    expect(JSON.parse(json.out).products).toMatchObject([{ product: 'ai', state: 'active' }]);
  });

  it('shows a development instance without a key as development, with exit code 0', async () => {
    const target = await boot('auto');
    const cwd = folder();
    const result = await license(target, ['status'], {}, { cwd });
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'No license keys: this development instance runs the premium plugins without one, on private hosts only.\nProduction needs a subscription: manablox license buy, or manablox license add <key>',
    );
    expect(result.out).toMatch(
      /AI +development, no license needed on private hosts; for production: https:\/\/licenses\.test\/buy\?products=ai/,
    );
    const json = await license(target, ['status'], { json: true }, { cwd });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).products).toMatchObject([{ product: 'ai', state: 'development' }]);
  });

  it('activates again, as another kind, and refreshes', async () => {
    const target = await boot();
    const key = target.server.addKey();
    const cwd = folder();
    await license(target, ['add', key], {}, { cwd });
    const dev = await license(
      target,
      ['activate', keyId(key).toLowerCase()],
      { dev: true },
      { cwd },
    );
    expect(dev.code, dev.err).toBe(0);
    expect(rows(target)[0]?.kind).toBe('development');
    const unknown = await license(target, ['activate', 'ZZZZZ'], {}, { cwd });
    expect(unknown.code).toBe(1);
    const refreshed = await license(target, ['refresh'], {}, { cwd });
    expect(refreshed.code, refreshed.err).toBe(0);
    expect(refreshed.out).toContain(`${keyId(key)}: refreshed, active`);
  });

  it('removes a key: deactivated on the server, out of .env and off the instance', async () => {
    const target = await boot();
    const key = target.server.addKey();
    const cwd = folder();
    await license(target, ['add', key], {}, { cwd });
    const result = await license(target, ['remove', keyId(key)], {}, { cwd });
    expect(result.code, result.err).toBe(0);
    expect(dotEnv(cwd)).toBe('MANABLOX_LICENSE_KEYS=\n');
    expect(rows(target)).toEqual([]);
    expect([...target.server.activations.values()][0]?.deactivated).toBe(true);
    // A reconcile does not bring it back.
    await target.services().licenses.reconcile();
    expect(rows(target)).toEqual([]);

    const none = await license(target, ['remove', 'ZZZZZ'], {}, { cwd });
    expect(none.code).toBe(1);
    expect(none.err).toContain('No key ZZZZZ');
  });

  it('removes a key added in the admin from the database', async () => {
    const target = await boot();
    const key = target.server.addKey();
    await target.services().licenses.addKey(key);
    const result = await license(target, ['remove', keyId(key)], {}, { cwd: folder() });
    expect(result.code, result.err).toBe(0);
    expect(rows(target)).toEqual([]);
  });

  it('opens the portal', async () => {
    const target = await boot();
    const cwd = folder();
    const subscriptions = await license(target, ['open'], {}, { cwd });
    const billing = await license(target, ['open', 'billing'], { browser: false }, { cwd });
    expect([...subscriptions.opened, ...billing.opened]).toEqual([
      { url: 'https://licenses.test/subscriptions', browser: true },
      { url: 'https://licenses.test/account', browser: false },
    ]);
    await expect(license(target, ['open', 'nope'], {}, { cwd })).rejects.toThrow(
      'nothing or billing',
    );
  });
});

describe('manablox license buy', () => {
  it('opens the portal, polls until the purchase is done, then adds the key', async () => {
    const target = await boot();
    const cwd = folder();
    let polls = 0;
    const result = await license(
      target,
      ['buy'],
      { plugins: 'ai', monthly: true, browser: false },
      {
        cwd,
        onSleep: () => {
          polls += 1;
          const [session] = target.server.sessions.values();
          if (polls === 2 && session) target.server.completeSession(session.id);
        },
      },
    );
    expect(result.code, result.err).toBe(0);
    const [session] = target.server.sessions.values();
    expect(session).toMatchObject({
      products: ['ai'],
      interval: 'month',
      instanceId: target.api.manablox.instance.id,
      trial: false,
      delivered: true,
    });
    expect(result.out).toContain('AI, monthly: €19.00 per month, 14-day trial');
    expect(result.out).toContain(`confirm the code ${session?.code} there`);
    expect(result.opened).toEqual([
      { url: `https://licenses.test/cli/${session?.code}`, browser: false },
    ]);
    expect(dotEnv(cwd)).toBe(`MANABLOX_LICENSE_KEYS=${session?.key}\n`);
    expect(result.out).toContain('the trial ends');
    expect(target.services().entitlement('ai').state).toBe('active');
  });

  it('asks for the plugins and the interval, with the prices of the catalogue', async () => {
    const target = await boot();
    const prompter = scripted(['ai,website', 'year']);
    const result = await license(
      target,
      ['buy'],
      {},
      {
        cwd: folder(),
        prompter,
        onSleep: (abort) => abort(),
      },
    );
    expect(prompter.asked).toEqual([
      'Which premium plugins? Both together are the bundle.',
      'Billed monthly or yearly?',
    ]);
    expect(result.out).toContain('AI + Website (bundle), yearly: price on request');
    expect([...target.server.sessions.values()][0]).toMatchObject({
      products: ['ai', 'website'],
      interval: 'year',
    });
    expect(result.code).toBe(130);
  });

  it('stops on Ctrl-C and on expiry, and says where the key will be', async () => {
    const target = await boot();
    const cancelled = await license(
      target,
      ['buy'],
      { plugins: 'website', yearly: true },
      {
        cwd: folder(),
        onSleep: (abort) => abort(),
      },
    );
    expect(cancelled.code).toBe(130);
    expect(cancelled.err).toContain(
      'https://licenses.test/subscriptions, then manablox license add <key>',
    );

    const expired = await license(
      target,
      ['buy'],
      { plugins: 'bundle', yearly: true },
      {
        cwd: folder(),
        onSleep: () => {
          for (const session of target.server.sessions.values()) session.status = 'expired';
        },
      },
    );
    expect(expired.code).toBe(1);
    expect(expired.err).toContain('The session expired');
  });

  it('gives up locally when the session outlives its lifetime', async () => {
    const target = await boot();
    const result = await license(
      target,
      ['buy'],
      { plugins: 'ai', monthly: true },
      {
        cwd: folder(),
        onSleep: () => {
          target.clock.now += 10 * 60_000;
        },
      },
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('The session expired');
  });

  it('refuses a missing choice without a terminal, and unknown plugins', async () => {
    const target = await boot();
    const cwd = folder();
    await expect(license(target, ['buy'], {}, { cwd })).rejects.toThrow('--plugins is needed');
    await expect(license(target, ['buy'], { plugins: 'ai' }, { cwd })).rejects.toThrow(
      '--monthly or --yearly is needed without a terminal',
    );
    await expect(
      license(target, ['buy'], { plugins: 'seo', monthly: true }, { cwd }),
    ).rejects.toThrow("--plugins takes ai, website or both, not 'seo'");
    expect(target.server.sessions.size).toBe(0);
  });

  it('passes --trial on as the session trial hint', async () => {
    const target = await boot();
    const result = await license(
      target,
      ['buy'],
      { plugins: 'ai', yearly: true, trial: true },
      { cwd: folder(), onSleep: (abort) => abort() },
    );
    expect(result.code).toBe(130);
    expect([...target.server.sessions.values()][0]).toMatchObject({
      products: ['ai'],
      interval: 'year',
      trial: true,
    });
  });

  it('buys without the instance with --no-activate: the key only goes to .env', async () => {
    const target = await boot();
    const cwd = folder();
    const result = await license(
      target,
      ['buy'],
      { plugins: 'ai', monthly: true, activate: false },
      {
        cwd,
        noRuntime: true,
        onSleep: () => {
          const [session] = target.server.sessions.values();
          if (session?.status === 'pending') target.server.completeSession(session.id);
        },
      },
    );
    expect(result.code, result.err).toBe(0);
    expect(result.booted()).toBe(0);
    expect([...target.server.sessions.values()][0]?.instanceId).toBeNull();
    expect(dotEnv(cwd)).toMatch(/^MANABLOX_LICENSE_KEYS=MBX-/);
    expect(target.server.activations.size).toBe(0);
  });
});
