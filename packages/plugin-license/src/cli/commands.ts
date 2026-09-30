import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CliCommandContext } from '@manablox/core';
import {
  keyId,
  PREMIUM_PRODUCT_IDS,
  PREMIUM_PRODUCTS,
  type PremiumProduct,
  parseLicenseKey,
} from '@manablox/license';
import type { LicenseKeyView, LicenseKind, LicenseOverview } from '../sdk.js';
import { LOCKED_STATES } from '../sdk.js';
import { licenseConfig } from '../server/config.js';
import type { LicenseServices } from '../server/services/index.js';
import {
  type BillingInterval,
  type Catalog,
  type CliSession,
  LicenseClient,
} from '../server/services/license/client.js';
import type { ActivationOptions } from '../server/services/license.service.js';
import { envKeys, KEYS_VARIABLE, keysEntry, withKey, withoutKey } from './env-file.js';
import { describeError, describeKeyError, type Places } from './messages.js';

/** What the commands reach beyond their context; tests hand in fakes. */
export interface LicenseCliDeps {
  /** `process.env` by default: `MANABLOX_LICENSE_SERVER` and the keys the shell sets. */
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  /** Waits `ms`; resolves early when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The clock in milliseconds. */
  now?: () => number;
}

/** The license server and portal the CLI talks to, from the environment. */
function setup(deps: LicenseCliDeps) {
  const env = deps.env ?? process.env;
  const config = licenseConfig(deps.fetch ? { fetch: deps.fetch } : {}, env);
  const client = new LicenseClient({ server: config.server, fetch: config.fetch });
  const places: Places = { server: config.server, portal: config.portal };
  return { env, client, places };
}

const sleepFor = async (ms: number, signal: AbortSignal) => {
  await delay(ms, undefined, { signal }).catch(() => undefined);
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '-');

const write = (stream: CliCommandContext['out'], lines: string | string[]) => {
  stream.write(`${([] as string[]).concat(lines).join('\n')}\n`);
};

async function services(context: CliCommandContext): Promise<LicenseServices> {
  return (await context.runtime<LicenseServices>()).plugin.services;
}

/** `--dev` or `--production`; neither leaves it to the instance. */
function kindOf(context: CliCommandContext): LicenseKind | undefined {
  const { dev, production } = context.values;
  if (dev === true && production === true) throw new Error('use --dev or --production, not both');
  if (dev === true) return 'development';
  if (production === true) return 'production';
  return undefined;
}

/** A key id as given: `ABCDE`, `mbx-abcde` or the whole key. */
function normaliseKeyId(input: string): string {
  const key = parseLicenseKey(input);
  if (key) return keyId(key);
  return input.trim().toUpperCase().replace(/^MBX-/, '').split('-')[0] as string;
}

function productList(products: readonly PremiumProduct[]): string {
  const labels = products.map((product) => PREMIUM_PRODUCTS[product].label);
  return products.length > 1 ? `${labels.join(' + ')} (bundle)` : (labels[0] ?? '');
}

// --- .env -------------------------------------------------------------------------------

type Stored = 'added' | 'present' | 'printed';

/**
 * Puts the key into `MANABLOX_LICENSE_KEYS` in the instance's `.env`. Without a `.env` it asks
 * whether to create one or to print the line for the deployment's environment; without a
 * prompter it prints the line.
 */
async function storeKey(
  context: CliCommandContext,
  key: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Stored> {
  const path = join(context.cwd, '.env');
  let text: string;
  if (existsSync(path)) {
    text = readFileSync(path, 'utf8');
  } else {
    const where = context.prompter
      ? await context.prompter.select({
          message: 'There is no .env here. Where should the key go?',
          options: [
            { value: 'create', label: 'Create .env with it' },
            {
              value: 'print',
              label: 'Show the line',
              hint: "for the deployment's environment",
            },
          ],
          initialValue: 'create',
        })
      : 'print';
    if (where === 'print') {
      write(context.out, [
        "Add this line to the instance's environment, then restart it:",
        `  ${keysEntry([key])}`,
      ]);
      return 'printed';
    }
    text = '';
  }
  const before = envKeys(text);
  const shell = env[KEYS_VARIABLE];
  const edited = withKey(text, key);
  if (edited.changed) writeFileSync(path, edited.text);
  write(
    context.out,
    edited.changed
      ? `Added ${keyId(key)} to ${KEYS_VARIABLE} in .env`
      : `${keyId(key)} is in .env already`,
  );
  // A variable the shell sets wins over `.env` when the instance starts.
  if (shell !== undefined && shell.trim() !== '' && shell !== before.join(',')) {
    const listed = shell.split(',').some((entry) => parseLicenseKey(entry) === key);
    if (!listed) {
      write(
        context.err,
        `${KEYS_VARIABLE} is set in this shell too and wins over .env; add ${keyId(key)} there as well`,
      );
    }
  }
  return edited.changed ? 'added' : 'present';
}

// --- Views ------------------------------------------------------------------------------

function summary(view: LicenseKeyView): string[] {
  const products = view.products.map((entry) => entry.label).join(', ') || 'no products';
  const lines = [`${view.keyId} is active here as ${view.kind ?? 'unknown'}: ${products}`];
  if (view.periodEnd) {
    lines.push(
      view.trialing
        ? `  the trial ends ${day(view.periodEnd)}`
        : `  the period ends ${day(view.periodEnd)}`,
    );
  }
  if (view.leaseExpiresAt) lines.push(`  the lease runs until ${day(view.leaseExpiresAt)}`);
  return lines;
}

/** Why a key failed, with what to do; `null` for a key without an error. */
function failure(view: LicenseKeyView, places: Places): string | null {
  if (!view.error) return null;
  return `${view.keyId}: ${describeKeyError(view.error.key, view.error.message, places)}`;
}

function viewOf(licenses: LicenseServices['licenses'], id: string): LicenseKeyView {
  const found = licenses.overview().keys.find((key) => key.id === id);
  if (!found) throw new Error(`the key is no longer on this instance`);
  return found;
}

/**
 * The end of an activation: its summary, its error, or the seat choice for `noSeats`, which
 * frees another instance's seat or activates this one as development and tries again.
 */
async function settle(
  context: CliCommandContext,
  licenses: LicenseServices['licenses'],
  first: LicenseKeyView,
  options: ActivationOptions,
  places: Places,
): Promise<number> {
  let view = first;
  for (;;) {
    if (!view.error && view.activated) {
      write(context.out, summary(view));
      return 0;
    }
    if (!view.error) {
      write(context.err, `${view.keyId} is not activated here`);
      return 1;
    }
    if (view.error.key !== 'plugins.license.key.noSeats') {
      write(context.err, failure(view, places) ?? '');
      return 1;
    }
    const holders = view.error.activations ?? [];
    write(context.err, [
      `Every production seat of ${view.keyId} is taken:`,
      ...holders.map(
        (holder) =>
          `  ${holder.name ?? holder.id}  ${holder.hostnames.join(', ') || '-'}  last seen ${day(holder.lastSeenAt)}`,
      ),
    ]);
    if (!context.prompter) {
      write(context.err, [
        `Free a seat in the portal (${places.portal}/subscriptions), then run manablox license activate ${view.keyId},`,
        `or activate this instance as development: manablox license activate ${view.keyId} --dev`,
      ]);
      return 1;
    }
    const choice = await context.prompter.select<string>({
      message: `How should ${view.keyId} get a seat here?`,
      options: [
        ...holders.map((holder) => ({
          value: `free:${holder.id}`,
          label: `Deactivate ${holder.name ?? holder.id}`,
          hint: `${holder.hostnames.join(', ') || 'no hostnames'}, last seen ${day(holder.lastSeenAt)}`,
        })),
        {
          value: 'development',
          label: 'Activate this instance as development',
          hint: 'takes no seat; private hostnames only',
        },
        { value: 'cancel', label: 'Cancel', hint: 'the key stays, not activated' },
      ],
      initialValue: 'cancel',
    });
    if (choice === 'cancel') {
      write(context.err, `${view.keyId} is not activated; run manablox license activate later`);
      return 1;
    }
    let retry = options;
    if (choice === 'development') retry = { ...options, kind: 'development' };
    else {
      try {
        await licenses.freeSeat(view.id, choice.slice('free:'.length));
        write(context.out, 'Deactivated that instance; activating here');
      } catch (error) {
        write(context.err, describeError(error, places));
        return 1;
      }
    }
    view = await licenses.activate(view.id, retry).catch(() => viewOf(licenses, view.id));
  }
}

// --- add --------------------------------------------------------------------------------

/** `license add`, also the end of `license buy`. */
async function addKey(
  context: CliCommandContext,
  input: string,
  deps: LicenseCliDeps,
  options: ActivationOptions & { activate: boolean },
): Promise<number> {
  const { env, places } = setup(deps);
  const key = parseLicenseKey(input);
  if (!key) {
    write(
      context.err,
      describeKeyError(
        'plugins.license.key.malformed',
        'That is not a license key. Keys look like MBX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.',
        places,
      ),
    );
    return 1;
  }
  const stored = await storeKey(context, key, env);
  if (stored === 'printed') return context.prompter ? 0 : 1;
  if (!options.activate) {
    write(context.out, 'The instance activates it when it starts.');
    return 0;
  }
  let licenses: LicenseServices['licenses'];
  try {
    ({ licenses } = await services(context));
  } catch (error) {
    write(context.err, [
      `The key is in .env, but the instance did not boot here: ${describeError(error, places)}`,
      '  It activates when the instance starts, or run manablox license activate once it runs.',
    ]);
    return 1;
  }
  const activation = { kind: options.kind, name: options.name };
  const view = await licenses.addEnvironmentKey(key, activation);
  return settle(context, licenses, view, activation, places);
}

export async function add(context: CliCommandContext, deps: LicenseCliDeps = {}): Promise<number> {
  const [input, ...rest] = context.positionals;
  if (!input || rest.length)
    throw new Error('license add takes one key: manablox license add MBX-...');
  const name = context.values.name;
  return addKey(context, input, deps, {
    kind: kindOf(context),
    name: typeof name === 'string' ? name : undefined,
    activate: context.values.activate !== false,
  });
}

// --- buy --------------------------------------------------------------------------------

/** `--plugins ai,website`; `bundle` is both. */
function productsOf(value: string): PremiumProduct[] {
  const picked = new Set<PremiumProduct>();
  for (const entry of value.split(',').map((part) => part.trim().toLowerCase())) {
    if (!entry) continue;
    if (entry === 'bundle') {
      for (const product of PREMIUM_PRODUCT_IDS) picked.add(product);
    } else if ((PREMIUM_PRODUCT_IDS as readonly string[]).includes(entry)) {
      picked.add(entry as PremiumProduct);
    } else {
      throw new Error(`--plugins takes ${PREMIUM_PRODUCT_IDS.join(', ')} or both, not '${entry}'`);
    }
  }
  if (!picked.size) throw new Error('--plugins names no premium plugin');
  return PREMIUM_PRODUCT_IDS.filter((product) => picked.has(product));
}

/** The plan that sells exactly these products at this interval. */
function planOf(
  catalog: Catalog | null,
  products: readonly PremiumProduct[],
  interval: BillingInterval,
) {
  return catalog?.plans.find(
    (plan) =>
      plan.interval === interval &&
      plan.grants.length === products.length &&
      products.every((product) => plan.grants.includes(product)),
  );
}

/** A plan's price and trial, as a hint. */
function priceOf(
  catalog: Catalog | null,
  products: readonly PremiumProduct[],
  interval: BillingInterval,
): string {
  if (!catalog) return 'price in the portal';
  const plan = planOf(catalog, products, interval);
  if (!plan) return 'not sold';
  const price = plan.price ? `${plan.price.formatted} per ${interval}` : 'price on request';
  return plan.trialDays > 0 ? `${price}, ${plan.trialDays}-day trial` : price;
}

type Polled =
  | { status: 'completed'; key: string }
  | { status: 'delivered' }
  | { status: 'expired' }
  | { status: 'cancelled' };

/** Polls until the portal completes the session, it expires or Ctrl-C cancels. */
async function poll(
  client: LicenseClient,
  session: CliSession,
  signal: AbortSignal,
  deps: LicenseCliDeps,
): Promise<Polled> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepFor;
  const deadline = now() + session.expiresIn * 1000;
  for (;;) {
    if (signal.aborted) return { status: 'cancelled' };
    if (now() >= deadline) return { status: 'expired' };
    await sleep(session.interval * 1000, signal);
    if (signal.aborted) return { status: 'cancelled' };
    let state: Awaited<ReturnType<LicenseClient['pollCliSession']>>;
    try {
      state = await client.pollCliSession(session);
    } catch (error) {
      // A lost connection or a busy server: the next poll tries again.
      const key = (error as { key?: unknown }).key;
      if (
        key === 'plugins.license.network' ||
        key === 'plugins.license.server.failed' ||
        key === 'plugins.license.rateLimited'
      ) {
        continue;
      }
      throw error;
    }
    if (state.status === 'expired') return { status: 'expired' };
    if (state.status === 'completed') {
      return state.key ? { status: 'completed', key: state.key } : { status: 'delivered' };
    }
  }
}

export async function buy(context: CliCommandContext, deps: LicenseCliDeps = {}): Promise<number> {
  const { client, places } = setup(deps);
  if (context.positionals.length) throw new Error('license buy takes no arguments');
  const { plugins, yearly, monthly } = context.values;
  if (yearly === true && monthly === true) throw new Error('use --yearly or --monthly, not both');
  if (typeof plugins !== 'string' && !context.prompter) {
    throw new Error('--plugins is needed without a terminal, e.g. --plugins ai,website');
  }
  if (yearly !== true && monthly !== true && !context.prompter) {
    throw new Error('--monthly or --yearly is needed without a terminal');
  }
  const catalog = await client.catalog().catch((error: unknown) => {
    write(context.err, `Prices are not available: ${describeError(error, places)}`);
    return null;
  });

  const products =
    typeof plugins === 'string'
      ? productsOf(plugins)
      : await (context.prompter as NonNullable<CliCommandContext['prompter']>).multiselect({
          message: 'Which premium plugins? Both together are the bundle.',
          options: PREMIUM_PRODUCT_IDS.map((product) => ({
            value: product,
            label: PREMIUM_PRODUCTS[product].label,
            hint: priceOf(catalog, [product], 'month'),
          })),
        });
  if (!products.length) throw new Error('pick at least one premium plugin');
  const interval: BillingInterval =
    yearly === true
      ? 'year'
      : monthly === true
        ? 'month'
        : await (
            context.prompter as NonNullable<CliCommandContext['prompter']>
          ).select<BillingInterval>({
            message: 'Billed monthly or yearly?',
            options: [
              { value: 'month', label: 'Monthly', hint: priceOf(catalog, products, 'month') },
              { value: 'year', label: 'Yearly', hint: priceOf(catalog, products, 'year') },
            ],
            initialValue: 'month',
          });
  write(
    context.out,
    `${productList(products)}, ${interval}ly: ${priceOf(catalog, products, interval)}`,
  );

  const activate = context.values.activate !== false;
  let instanceId: string | undefined;
  if (activate) {
    try {
      instanceId = (await context.runtime()).plugin.manablox.instance.id;
    } catch (error) {
      write(
        context.err,
        `The instance did not boot here (${describeError(error, places)}); buying without it, the key is activated when it starts`,
      );
    }
  }

  let session: CliSession;
  try {
    session = await client.startCliSession({
      products,
      interval,
      ...(instanceId ? { instanceId } : {}),
      ...(context.values.trial === true ? { trial: true } : {}),
    });
  } catch (error) {
    write(context.err, describeError(error, places));
    return 1;
  }
  write(
    context.out,
    `Opening ${new URL(session.url).host} ... confirm the code ${session.code} there.`,
  );
  await context.open(session.url, { browser: context.values.browser !== false });

  const polled = await context.spin(
    'Waiting for the purchase; close the browser tab once it is paid',
    () => poll(client, session, context.signal, deps),
    (result) =>
      result.status === 'completed'
        ? 'Purchase complete'
        : result.status === 'cancelled'
          ? 'Stopped waiting'
          : result.status === 'expired'
            ? 'The session expired'
            : 'The session was completed before',
  );
  if (polled.status === 'cancelled') {
    write(context.err, [
      'Cancelled. If you finish the purchase in the browser, the key is in the portal and in your mail:',
      `  ${places.portal}/subscriptions, then manablox license add <key>`,
    ]);
    return 130;
  }
  if (polled.status === 'expired') {
    write(context.err, 'The session expired; start again with manablox license buy');
    return 1;
  }
  if (polled.status === 'delivered') {
    write(context.err, [
      'The key of this session was handed out already.',
      `  Copy it from the portal (${places.portal}/subscriptions) and run manablox license add <key>`,
    ]);
    return 1;
  }
  write(context.out, `Received the key ${keyId(polled.key)}`);
  return addKey(context, polled.key, deps, { activate });
}

// --- status, activate, refresh, remove, open --------------------------------------------

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
      .join('  ')
      .trimEnd(),
  );
}

/** Whether a product the configured plugins sell is locked. */
const locked = (overview: LicenseOverview) =>
  overview.products.some((product) => LOCKED_STATES.includes(product.state));

export async function status(
  context: CliCommandContext,
  deps: LicenseCliDeps = {},
): Promise<number> {
  const { places } = setup(deps);
  const { licenses } = await services(context);
  const overview = licenses.overview();
  if (context.values.json === true) {
    write(context.out, JSON.stringify(overview, null, 2));
    return locked(overview) ? 1 : 0;
  }
  if (overview.managed) write(context.out, 'Managed by Manablox Cloud.');
  if (overview.keys.length) {
    write(
      context.out,
      table([
        ['key', 'source', 'products', 'kind', 'state', 'period end', 'lease until', 'refreshed'],
        ...overview.keys.map((key) => [
          key.keyId,
          key.source === 'environment' ? 'env' : 'admin',
          key.products.map((product) => product.product).join(',') || '-',
          key.kind ?? '-',
          key.deactivated ? 'deactivated' : (key.state ?? 'not activated'),
          `${day(key.periodEnd)}${key.trialing ? ' (trial)' : ''}`,
          day(key.leaseExpiresAt),
          day(key.refreshedAt),
        ]),
      ]),
    );
    for (const key of overview.keys) {
      const failed = failure(key, places);
      if (failed) write(context.err, failed);
    }
  } else if (overview.products.some((product) => product.state === 'development')) {
    write(context.out, [
      'No license keys: this development instance runs the premium plugins without one, on private hosts only.',
      'Production needs a subscription: manablox license buy, or manablox license add <key>',
    ]);
  } else {
    write(context.out, 'No license keys: manablox license buy, or manablox license add <key>');
  }
  if (overview.products.length) {
    write(context.out, ['', 'Products']);
    for (const product of overview.products) {
      const until = product.periodEnd ? `, period ends ${day(product.periodEnd)}` : '';
      const kind = product.kind ? ` (${product.kind})` : '';
      const buy = LOCKED_STATES.includes(product.state)
        ? `, buy: ${product.buyUrl}`
        : product.state === 'development'
          ? `, no license needed on private hosts; for production: ${product.buyUrl}`
          : '';
      write(context.out, `  ${product.label.padEnd(8)} ${product.state}${kind}${until}${buy}`);
    }
  }
  return locked(overview) ? 1 : 0;
}

/** The keys a key id names, or all of them. */
function pick(overview: LicenseOverview, input: string | undefined): LicenseKeyView[] {
  if (input === undefined) return overview.keys;
  const id = normaliseKeyId(input);
  return overview.keys.filter((key) => key.keyId === id);
}

export async function activate(
  context: CliCommandContext,
  deps: LicenseCliDeps = {},
): Promise<number> {
  const { places } = setup(deps);
  const [input, ...rest] = context.positionals;
  if (rest.length) throw new Error('license activate takes at most one key id');
  const kind = kindOf(context);
  const { licenses } = await services(context);
  const keys = pick(licenses.overview(), input);
  if (!keys.length) {
    write(
      context.err,
      input ? `No key ${normaliseKeyId(input)} on this instance` : 'No license keys here',
    );
    return 1;
  }
  let code = 0;
  for (const key of keys) {
    const options = { kind };
    const view = await licenses.activate(key.id, options).catch(() => viewOf(licenses, key.id));
    code = Math.max(code, await settle(context, licenses, view, options, places));
  }
  return code;
}

export async function refresh(
  context: CliCommandContext,
  deps: LicenseCliDeps = {},
): Promise<number> {
  const { places } = setup(deps);
  if (context.positionals.length) throw new Error('license refresh takes no arguments');
  const { licenses } = await services(context);
  const { keys } = licenses.overview();
  if (!keys.length) {
    write(context.out, 'No license keys here');
    return 0;
  }
  let code = 0;
  for (const key of keys) {
    try {
      const view = await licenses.refresh(key.id);
      write(context.out, `${view.keyId}: refreshed, ${view.state ?? 'no lease'}`);
    } catch (error) {
      write(context.err, `${key.keyId}: ${describeError(error, places)}`);
      code = 1;
    }
  }
  return code;
}

export async function remove(
  context: CliCommandContext,
  deps: LicenseCliDeps = {},
): Promise<number> {
  const { places } = setup(deps);
  const [input, ...rest] = context.positionals;
  if (!input || rest.length)
    throw new Error('license remove takes one key id: manablox license remove ABCDE');
  const id = normaliseKeyId(input);
  const path = join(context.cwd, '.env');
  const edited = existsSync(path)
    ? withoutKey(readFileSync(path, 'utf8'), id)
    : { text: '', removed: [] };

  let code = 0;
  let key: LicenseKeyView | undefined;
  try {
    const { licenses } = await services(context);
    key = pick(licenses.overview(), id)[0];
    if (key?.source === 'admin') await licenses.removeKey(key.id);
    else if (key) await licenses.removeEnvironmentKey(key.id);
  } catch (error) {
    write(context.err, `The instance did not deactivate ${id}: ${describeError(error, places)}`);
    code = 1;
  }
  if (edited.removed.length) {
    writeFileSync(path, edited.text);
    write(context.out, `Took ${id} out of ${KEYS_VARIABLE} in .env`);
  } else if (key?.source === 'environment') {
    write(
      context.err,
      `${id} is not in .env: take it out of the instance's environment too, or its next start adds it again`,
    );
  }
  if (key) write(context.out, `Removed ${id} from this instance and freed its activation`);
  else if (!edited.removed.length) {
    write(context.err, `No key ${id} on this instance or in .env`);
    return 1;
  }
  return code;
}

export async function open(context: CliCommandContext, deps: LicenseCliDeps = {}): Promise<number> {
  const { places } = setup(deps);
  const [page, ...rest] = context.positionals;
  if (rest.length || (page !== undefined && page !== 'billing')) {
    throw new Error('license open takes nothing or billing');
  }
  const url = `${places.portal}${page === 'billing' ? '/account' : '/subscriptions'}`;
  await context.open(url, { browser: context.values.browser !== false });
  return 0;
}
