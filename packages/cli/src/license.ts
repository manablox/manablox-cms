import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliValues } from '@manablox/core';
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

/** Whether `MANABLOX_LICENSE_KEYS` lists anything, in `.env` or in the environment. */
function keysConfigured(cwd: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const path = join(cwd, '.env');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = [...text.matchAll(/^\s*(?:export\s+)?MANABLOX_LICENSE_KEYS\s*=(.*)$/gm)];
  const listed = (value: string | undefined) => /MBX-/i.test((value ?? '').replace(/#.*$/, ''));
  return listed(lines.at(-1)?.[1]) || listed(env.MANABLOX_LICENSE_KEYS);
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

/**
 * Which of `products` no license covers: the license states of a ready instance, else
 * whether any key is configured at all.
 */
export async function uncovered(
  products: readonly PremiumProduct[],
  setup: PremiumSetup,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PremiumProduct[]> {
  const states = setup.ready ? await licenseStates(setup) : null;
  if (states) return products.filter((product) => LOCKED.has(states.get(product) ?? 'missing'));
  return keysConfigured(setup.cwd, env) ? [] : [...products];
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

type Choice = 'trial' | 'buy' | 'add' | 'later';

/**
 * "AI is a premium plugin": start a trial, buy, enter a key, or later. Runs the license
 * plugin's `buy` or `add`; without a prompter it prints the commands. The plugins stay
 * installed whatever happens; without a license they are locked.
 */
export async function premiumPrompt(
  products: readonly PremiumProduct[],
  setup: PremiumSetup,
): Promise<void> {
  if (!products.length) return;
  const names = products.map(label).join(' and ');
  const are = products.length > 1 ? 'are premium plugins' : 'is a premium plugin';
  const later = () => {
    setup.out.write(
      `${names} ${products.length > 1 ? 'stay' : 'stays'} locked until a license covers ${products.length > 1 ? 'them' : 'it'}:\n${licenseSteps(
        products,
      )
        .map((line) => `  ${line}\n`)
        .join('')}`,
    );
  };
  if (!setup.prompter) {
    setup.out.write(`${names} ${are}.\n`);
    later();
    return;
  }
  const values: CliValues = setup.ready ? {} : { activate: false };
  try {
    const choice = await setup.prompter.select<Choice>({
      message: `${names} ${are}. License ${products.length > 1 ? 'them' : 'it'} now?`,
      options: [
        {
          value: 'trial',
          label: 'Start a 14-day trial',
          hint: 'in the browser; the portal checks the trial is still free',
        },
        { value: 'buy', label: 'Buy a subscription', hint: 'in the browser' },
        { value: 'add', label: 'Enter a key I already have' },
        { value: 'later', label: 'Later', hint: 'installed anyway, locked until licensed' },
      ],
      initialValue: 'trial',
    });
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
    if (choice === 'later' || code !== 0) later();
  } catch (error) {
    if (!(error instanceof Cancelled)) {
      setup.err.write(`manablox: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    later();
  }
}
