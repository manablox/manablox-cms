import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliValues } from '@manablox/core';
import { isPrivateHostname } from '@manablox/license';
import { type PluginCommandSetup, runPluginCommand } from './commands/plugin.js';
import { type CliPlugin, FIRST_PARTY_PLUGINS } from './plugins.js';
import { Cancelled } from './ui.js';

/** A premium product, as `FIRST_PARTY_PLUGINS` names it. */
export type PremiumProduct = NonNullable<(typeof FIRST_PARTY_PLUGINS)[number]['premium']>;

/** The license plugin's id. */
export const LICENSE_PLUGIN = 'license';

/** The states that leave a product locked (`@manablox/plugin-license`). */
const LOCKED = new Set(['lapsed', 'missing']);

/** How the license plugin's commands run for `plugin install` and `create`. */
export interface PremiumSetup extends PluginCommandSetup {
  /** The license plugin's CLI contribution. */
  license: CliPlugin;
  /**
   * The instance's database is migrated and answers here: keys are activated now. Otherwise
   * they only go into `.env`, and the instance activates them when it starts.
   */
  ready: boolean;
  /**
   * A development setup (a local instance on private hosts): the premium plugins run there
   * without a key, so the prompt leads with continuing without one.
   */
  development?: boolean;
}

/** The premium products of these first-party plugin ids, in catalogue order. */
export function premiumProducts(ids: readonly string[]): PremiumProduct[] {
  return FIRST_PARTY_PLUGINS.flatMap((plugin) =>
    plugin.premium && ids.includes(plugin.id) ? [plugin.premium] : [],
  );
}

/** The products' names, as `@manablox/license` has them. */
const LABELS: Record<PremiumProduct, string> = { ai: 'AI', website: 'Website' };
const label = (product: PremiumProduct) => LABELS[product];

/** A variable of the instance: the environment's, else the last one in `.env`. */
function variables(cwd: string, env: Readonly<Record<string, string | undefined>>) {
  const path = join(cwd, '.env');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return (name: string): string | undefined => {
    if (env[name] !== undefined) return env[name];
    const lines = [...text.matchAll(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`, 'gm'))];
    const value = lines.at(-1)?.[1];
    return value === undefined ? undefined : value.replace(/#.*$/, '').trim();
  };
}

/** Whether `MANABLOX_LICENSE_KEYS` lists anything, in `.env` or in the environment. */
function keysConfigured(cwd: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const path = join(cwd, '.env');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = [...text.matchAll(/^\s*(?:export\s+)?MANABLOX_LICENSE_KEYS\s*=(.*)$/gm)];
  const listed = (value: string | undefined) => /MBX-/i.test((value ?? '').replace(/#.*$/, ''));
  return listed(lines.at(-1)?.[1]) || listed(env.MANABLOX_LICENSE_KEYS);
}

/**
 * Whether an instance that does not answer yet looks like a development one, by its `.env`:
 * `NODE_ENV` and `MANABLOX_LICENSE_KIND` are not `production`, it is no docker preset (whose
 * compose file runs production; its `.env` has `ADMIN_DOMAIN` or `ADMIN_PORT`), and its
 * `PUBLIC_URL` and `PUBLIC_API_URL` are private. The instance decides for itself once it runs.
 */
export function developmentSetup(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const variable = variables(cwd, env);
  if (variable('NODE_ENV') === 'production') return false;
  if (variable('MANABLOX_LICENSE_KIND') === 'production') return false;
  if (variable('ADMIN_DOMAIN') !== undefined || variable('ADMIN_PORT') !== undefined) return false;
  const devHosts = (variable('MANABLOX_LICENSE_DEV_HOSTS') ?? '').split(',').filter(Boolean);
  const urls = [variable('PUBLIC_URL'), variable('PUBLIC_API_URL')].filter((url): url is string =>
    Boolean(url),
  );
  return urls.length > 0 && urls.every((url) => isPrivateHostname(url, devHosts));
}

/** A writer that keeps what it is given. */
function capture() {
  let text = '';
  return { write: (chunk: string) => (text += chunk), text: () => text };
}

/**
 * The license state of each product the configured plugins sell, from `license status --json`
 * on the booted instance; `null` when the instance cannot tell.
 */
export async function licenseStates(
  setup: PremiumSetup,
): Promise<Map<PremiumProduct, string> | null> {
  const out = capture();
  try {
    await runPluginCommand(
      setup.license,
      ['status'],
      { json: true },
      { ...setup, out, err: capture(), prompter: null },
    );
    const overview = JSON.parse(out.text()) as {
      products?: Array<{ product: PremiumProduct; state: string }>;
    };
    return new Map((overview.products ?? []).map((entry) => [entry.product, entry.state]));
  } catch {
    return null;
  }
}

/** The products no license covers, and whether the instance runs them anyway. */
export interface Uncovered {
  products: PremiumProduct[];
  /** A development instance: they run without a key, on private hosts. */
  development: boolean;
}

/**
 * Which of `products` no license covers: the license states of a ready instance (locked, or
 * `development`: running without a license), else whether any key is configured at all and
 * whether the `.env` looks like a development setup.
 */
export async function uncovered(
  products: readonly PremiumProduct[],
  setup: PremiumSetup,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Uncovered> {
  const states = setup.ready ? await licenseStates(setup) : null;
  if (states) {
    const state = (product: PremiumProduct) => states.get(product) ?? 'missing';
    const open = products.filter(
      (product) => LOCKED.has(state(product)) || state(product) === 'development',
    );
    return {
      products: open,
      development: open.length > 0 && open.every((product) => state(product) === 'development'),
    };
  }
  return keysConfigured(setup.cwd, env)
    ? { products: [], development: false }
    : { products: [...products], development: developmentSetup(setup.cwd, env) };
}

/**
 * The license commands to run later, for the next steps. Each runs without a terminal too:
 * `buy` then needs the interval.
 */
export function licenseSteps(products: readonly PremiumProduct[], cli = 'manablox'): string[] {
  const buy = `${cli} license buy --plugins ${products.join(',')}`;
  return [
    `${buy} --trial --monthly   # a 14-day free trial`,
    `${buy} --monthly   # or subscribe (--yearly for a year)`,
    `${cli} license add <key>   # or a key you have`,
  ];
}

type Choice = 'trial' | 'buy' | 'add' | 'later' | 'development';

/**
 * "AI is a premium plugin": start a trial, buy, enter a key, or later. On a development setup
 * it says the plugins run there without a key and leads with continuing without one. Runs
 * the license plugin's `buy` or `add`; without a prompter it prints the commands. The
 * plugins stay installed whatever happens; without a license they are locked, except on a
 * development instance.
 */
export async function premiumPrompt(
  products: readonly PremiumProduct[],
  setup: PremiumSetup,
): Promise<void> {
  if (!products.length) return;
  const many = products.length > 1;
  const names = products.map(label).join(' and ');
  const are = many ? 'are premium plugins' : 'is a premium plugin';
  const them = many ? 'them' : 'it';
  const development = setup.development === true;
  const steps = licenseSteps(products)
    .map((line) => `  ${line}\n`)
    .join('');
  const later = () => {
    setup.out.write(
      development
        ? `${names} ${many ? 'run' : 'runs'} here without a license key, on private hosts only. A production instance needs a subscription:\n${steps}`
        : `${names} ${many ? 'stay' : 'stays'} locked until a license covers ${them}:\n${steps}`,
    );
  };
  if (!setup.prompter) {
    setup.out.write(`${names} ${are}.\n`);
    later();
    return;
  }
  const values: CliValues = setup.ready ? {} : { activate: false };
  const licensing = [
    {
      value: 'trial' as const,
      label: 'Start a 14-day trial',
      hint: 'in the browser; the portal checks the trial is still free',
    },
    { value: 'buy' as const, label: 'Buy a subscription', hint: 'in the browser' },
    { value: 'add' as const, label: 'Enter a key I already have' },
  ];
  try {
    const choice = await setup.prompter.select<Choice>(
      development
        ? {
            message: `${names} ${are}. On this local instance ${many ? 'they run' : 'it runs'} without a license key; production needs a subscription. License ${them} now?`,
            options: [
              {
                value: 'development',
                label: 'Continue without a key (development)',
                hint: 'private hosts only; license before going to production',
              },
              ...licensing,
            ],
            initialValue: 'development',
          }
        : {
            message: `${names} ${are}. License ${them} now?`,
            options: [
              ...licensing,
              { value: 'later', label: 'Later', hint: 'installed anyway, locked until licensed' },
            ],
            initialValue: 'trial',
          },
    );
    let code = 0;
    if (choice === 'trial' || choice === 'buy') {
      code = await runPluginCommand(
        setup.license,
        ['buy'],
        { ...values, plugins: products.join(','), ...(choice === 'trial' ? { trial: true } : {}) },
        setup,
      );
    } else if (choice === 'add') {
      const key = await setup.prompter.text({
        message: 'License key',
        defaultValue: '',
        validate: (value) => (/^MBX-/i.test(value.trim()) ? undefined : 'Paste the key: MBX-...'),
      });
      code = await runPluginCommand(setup.license, ['add', key], values, setup);
    }
    if (choice === 'later' || choice === 'development' || code !== 0) later();
  } catch (error) {
    if (!(error instanceof Cancelled)) {
      setup.err.write(`manablox: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    later();
  }
}
