import { createHash } from 'node:crypto';
import {
  type AdminBanner,
  auditor,
  type Contribution,
  type FeatureCeilingProvider,
  type FeatureControl,
  type FeatureKey,
  ManabloxError,
} from '@manablox/core';
import { decryptSecret, encryptSecret, type Logger } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import {
  isPrivateHostname,
  keyId,
  PREMIUM_PRODUCT_IDS,
  PREMIUM_PRODUCTS,
  type PremiumProduct,
  parseLicenseKey,
} from '@manablox/license';
import type {
  LicenseKeyError,
  LicenseKeyView,
  LicenseKind,
  LicenseOverview,
  LicenseProductEntry,
  LicenseProductView,
  LicenseSeatHolder,
} from '../../sdk.js';
import { LICENSE_KEY_ENTITY } from '../audit.js';
import type { LicenseConfig } from '../config.js';
import {
  type LicenseActivationPatch,
  type LicenseActivationRow,
  licenseRepos,
} from '../db/index.js';
import { licenseError, licenseMessage } from '../errors.js';
import {
  ceilingBanners,
  ceilingFeatures,
  lapseSets,
  type PortalLinks,
  portalLinks,
} from './license/ceilings.js';
import { type InstanceFacts, LicenseClient } from './license/client.js';
import {
  type CheckedLease,
  checkLease,
  decodeLease,
  type Entitlement,
  entitlementOf,
  nextChange,
} from './license/state.js';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** A lease older than this is refreshed. */
const REFRESH_AFTER_MS = DAY_MS;
/** A lease ending within this is refreshed whatever its age. */
const REFRESH_BEFORE_END_MS = 7 * DAY_MS;
/** The first retry after a failure; each further one waits twice as long, up to a day. */
const BACKOFF_MS = 6 * HOUR_MS;
const BACKOFF_MAX_MS = DAY_MS;
/** The clock checks for due state changes this often; the rows are read again every tenth. */
const TICK_MS = 60_000;
const RELOAD_EVERY_TICKS = 10;

/** Failures that stay until someone acts: no automatic call is made after them. */
const PERMANENT = new Set([
  'plugins.license.key.invalid',
  'plugins.license.key.revoked',
  'plugins.license.key.bound',
  'plugins.license.activation.conflict',
  'plugins.license.activation.notFound',
]);

/** A row without an activation or lease. */
const UNLEASED = {
  activationId: null,
  kind: null,
  lease: null,
  leaseExp: null,
  refreshSecret: null,
  conflictAt: null,
} satisfies LicenseActivationPatch;

/** The instance-wide lock every write to the rows holds, across processes. */
const LOCK = 'plugin:license';

export interface LicenseServiceOptions {
  config: LicenseConfig;
  repos: Repositories;
  logger: Logger;
  /** The instance secret keys and refresh secrets are encrypted with. */
  secret: string;
  /** The instance id; read when needed, since it is loaded at boot. */
  instanceId: () => string;
  /** The `license.products` entries of the configured plugins. */
  products: () => readonly Contribution<LicenseProductEntry>[];
  /** Every hostname the instance serves: its configured URLs and the plugins' ones. */
  hostnames: () => Promise<string[]>;
  /** Manablox and plugin versions, sent with every call. */
  versions: Record<string, string>;
  /**
   * The admin's hostname: the default name in the portal, with the start of the instance id
   * so that several local instances tell apart. Without it, the first public hostname.
   */
  adminHostname?: string | undefined;
  /** Tells the instance's other processes to read the rows again. */
  publish: () => void;
  /** `NODE_ENV`, for the `auto` kind. */
  nodeEnv?: string | undefined;
}

/** How one activation call goes, beside the config: the CLI's `--dev`, `--production`, `--name`. */
export interface ActivationOptions {
  kind?: LicenseKind | undefined;
  name?: string | undefined;
}

/** One stored key with its lease checked. */
interface KeyState {
  row: LicenseActivationRow;
  checked: CheckedLease;
}

/** What the rows give, at one moment; features and banners already built for the ceiling. */
interface Evaluation {
  keys: KeyState[];
  entitlements: Map<PremiumProduct, Entitlement>;
  features: ReadonlyMap<FeatureKey, FeatureControl>;
  banners: AdminBanner[];
  /** Unix seconds of the next clock-driven change, or `null`. */
  due: number | null;
  /** Changes when the ceiling does. */
  fingerprint: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (date: Date | null) => (date ? date.toISOString() : null);

/**
 * The instance's license keys: their activations on the license server, the leases every
 * process verifies, and the ceiling that locks products no valid lease covers. Writes run
 * on management instances under an instance-wide lock and tell the other processes to
 * read the rows again. Nothing on the request path calls the license server.
 */
export class LicenseService {
  private readonly client: LicenseClient;
  private readonly links: PortalLinks;
  private rows: LicenseActivationRow[] = [];
  private hostnames: string[] = [];
  /** `null` until the rows are read: every product counts as locked then. */
  private evaluation: Evaluation | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private ticks = 0;

  constructor(private readonly options: LicenseServiceOptions) {
    this.client = new LicenseClient({ server: options.config.server, fetch: options.config.fetch });
    this.links = portalLinks(options.config.portal);
  }

  private get repo() {
    return licenseRepos(this.options.repos);
  }

  private nowMs(): number {
    return this.options.config.now();
  }

  // --- Reading: every process ---------------------------------------------------------

  /** Reads the rows and the instance's hostnames, then evaluates. Never throws. */
  async load(): Promise<void> {
    try {
      const [rows, hostnames] = await Promise.all([this.repo.list(), this.options.hostnames()]);
      this.rows = rows;
      this.hostnames = hostnames;
      this.evaluate();
    } catch (error) {
      this.options.logger.error({ err: error }, 'license rows not read; premium products locked');
      this.failClosed();
    }
  }

  /**
   * Reads the rows now and whenever another process wrote them, and checks the clock every
   * minute. For every process, before it serves.
   */
  async boot(channel: {
    subscribe(listener: (message: unknown) => void): () => void;
  }): Promise<void> {
    this.unsubscribe ??= channel.subscribe(() => void this.load());
    await this.load();
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.ticks += 1;
      if (this.ticks % RELOAD_EVERY_TICKS === 0) void this.load();
      else this.version();
    }, TICK_MS);
    this.timer.unref?.();
  }

  /** Stops the clock and the channel listener. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Whether an instance hostname is public, so development leases cover nothing. */
  private publicHostnames(): boolean {
    return this.hostnames.some((host) => !isPrivateHostname(host, this.options.config.devHosts));
  }

  private evaluate(): void {
    try {
      const nowSeconds = Math.floor(this.nowMs() / 1000);
      const context = {
        now: nowSeconds,
        instanceId: this.options.instanceId(),
        trustedKeys: this.options.config.trustedKeys,
      };
      const keys = this.rows.map((row) => ({
        row,
        checked: checkLease(
          {
            rowId: row.id,
            token: row.lease,
            refreshFailed: row.lastError !== null,
            conflict: row.conflictAt !== null,
          },
          context,
        ),
      }));
      const checked = keys.map((key) => key.checked);
      const publicHostnames = this.publicHostnames();
      const entitlements = new Map(
        PREMIUM_PRODUCT_IDS.map((product) => [
          product,
          entitlementOf(product, checked, { publicHostnames }),
        ]),
      );
      this.adopt(keys, entitlements, nextChange(checked, nowSeconds));
    } catch (error) {
      this.options.logger.error({ err: error }, 'licenses not evaluated; premium products locked');
      this.failClosed();
    }
  }

  /** Every product locked, as `lapsed`: what counts when the state cannot be read. */
  private failClosed(): void {
    const entitlements = new Map(
      PREMIUM_PRODUCT_IDS.map((product): [PremiumProduct, Entitlement] => [
        product,
        { product, state: 'lapsed', kind: null, periodEnd: null, exp: null, reason: 'unchecked' },
      ]),
    );
    try {
      this.adopt(this.evaluation?.keys ?? [], entitlements, null);
    } catch (error) {
      // Only the contributions are read here; without them nothing can be locked either.
      this.options.logger.error({ err: error }, 'license ceiling not built');
    }
  }

  /** Builds the ceiling for the sold products and bumps the version when it changed. */
  private adopt(
    keys: KeyState[],
    entitlements: Map<PremiumProduct, Entitlement>,
    due: number | null,
  ): void {
    const lapse = lapseSets(this.options.products());
    const sold = [...entitlements.values()].filter((entry) => lapse.has(entry.product));
    const features = ceilingFeatures(sold, lapse, this.links);
    const banners = ceilingBanners(sold, this.links);
    const fingerprint = JSON.stringify([
      [...features].map(([key, value]) => [key, value.message]),
      banners.map((banner) => [banner.id, banner.text]),
      [...entitlements.values()].map((entry) => [entry.state, entry.kind, entry.exp?.getTime()]),
    ]);
    const changed = fingerprint !== this.evaluation?.fingerprint;
    this.evaluation = { keys, entitlements, features, banners, due, fingerprint };
    if (changed) this.generation += 1;
  }

  /** Changes whenever the ceiling does; evaluates again once a clock-driven change is due. */
  version(): number {
    try {
      const due = this.evaluation?.due;
      if (due != null && this.nowMs() / 1000 >= due) this.evaluate();
    } catch (error) {
      this.options.logger.error({ err: error }, 'license version not checked');
    }
    return this.generation;
  }

  /** The ceiling of every process. It never throws: what cannot be evaluated is locked. */
  ceiling(): FeatureCeilingProvider {
    return {
      features: () => this.evaluated().features,
      version: () => this.version(),
      banners: () => this.evaluated().banners,
    };
  }

  private evaluated(): Evaluation {
    if (!this.evaluation) this.failClosed();
    return this.evaluation ?? EMPTY;
  }

  /** What a product's license allows now. */
  entitlement(product: PremiumProduct): Entitlement {
    this.version();
    return (
      this.evaluated().entitlements.get(product) ?? {
        product,
        state: 'lapsed',
        kind: null,
        periodEnd: null,
        exp: null,
        reason: 'unchecked',
      }
    );
  }

  /**
   * Whether a request for `host` may use the product. Only a development lease restricts
   * hosts: the product then serves private hosts alone. A locked product answers true, since
   * its lapse set already switches it off where it has to be.
   */
  allowsHost(product: PremiumProduct, host: string): boolean {
    const entitlement = this.entitlement(product);
    if (entitlement.kind !== 'development') return true;
    return isPrivateHostname(host, this.options.config.devHosts);
  }

  /** Settings → Licenses. */
  overview(): LicenseOverview {
    this.version();
    const { keys, entitlements } = this.evaluated();
    const sold = new Set(lapseSets(this.options.products()).keys());
    const products: LicenseProductView[] = [...entitlements.values()]
      .filter((entry) => sold.has(entry.product))
      .map((entry) => ({
        product: entry.product,
        label: PREMIUM_PRODUCTS[entry.product].label,
        state: entry.state,
        kind: entry.kind,
        periodEnd: iso(entry.periodEnd),
        expiresAt: iso(entry.exp),
        buyUrl: this.links.buy(entry.product),
      }));
    const views = keys.map((key) => this.view(key));
    return {
      keys: views,
      products,
      portal: this.options.config.portal,
      managed: views.length > 0 && views.every((view) => view.kind === 'hosted'),
    };
  }

  private view({ row, checked }: KeyState): LicenseKeyView {
    const payload = checked.lease ?? checked.payload;
    return {
      id: row.id,
      keyId: row.keyId,
      source: row.source,
      products: (payload?.products ?? []).map((product) => ({
        product,
        label: PREMIUM_PRODUCTS[product].label,
      })),
      kind: payload?.kind ?? row.kind,
      state: checked.state ?? (row.lease ? 'lapsed' : null),
      periodEnd: payload ? new Date(payload.periodEnd * 1000).toISOString() : null,
      trialing: payload?.status === 'trialing',
      leaseExpiresAt: iso(row.leaseExp),
      refreshedAt: iso(row.refreshedAt),
      activated: row.activationId !== null,
      deactivated: row.deactivatedAt !== null,
      error: row.lastError,
    };
  }

  // --- Writing: management instances ------------------------------------------------------

  /** Runs `fn` under the instance-wide lock, then reads the rows again here and elsewhere. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.options.repos.locks.withLock(LOCK, fn);
    } finally {
      await this.load();
      this.options.publish();
    }
  }

  private facts(): Promise<InstanceFacts> {
    return this.options.hostnames().then((hostnames) => ({
      hostnames,
      versions: this.options.versions,
    }));
  }

  /** The kind to activate as: forced by the config, else by the environment and hostnames. */
  async activationKind(): Promise<LicenseKind> {
    const { kind, devHosts } = this.options.config;
    if (kind !== 'auto') return kind;
    if (this.options.nodeEnv === 'production') return 'production';
    const hostnames = await this.options.hostnames();
    return hostnames.every((host) => isPrivateHostname(host, devHosts))
      ? 'development'
      : 'production';
  }

  /** The key a row stands for: from the config by its hash, or decrypted from the row. */
  private keyOf(row: LicenseActivationRow): string | null {
    if (row.keyEnc) return decryptSecret(row.keyEnc, this.options.secret);
    return this.options.config.keys.find((key) => sha256(key) === row.keyHash) ?? null;
  }

  /** Whether an automatic call may be made for the row now. */
  private retries(row: LicenseActivationRow): boolean {
    if (row.deactivatedAt || row.conflictAt) return false;
    if (row.lastError && PERMANENT.has(row.lastError.key)) return false;
    return !row.retryAt || row.retryAt.getTime() <= this.nowMs();
  }

  /** Records a failed call: the error, and when to try again. */
  private async failed(row: LicenseActivationRow, error: unknown): Promise<LicenseKeyError> {
    const recorded = errorOf(error);
    const failures = row.failures + 1;
    const retryAfter = recorded.retryAfter;
    const wait =
      typeof retryAfter === 'number'
        ? retryAfter * 1000
        : Math.min(BACKOFF_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    const patch: LicenseActivationPatch = {
      lastError: recorded.error,
      failures,
      retryAt: new Date(this.nowMs() + wait),
    };
    if (recorded.error.key === 'plugins.license.activation.conflict') {
      patch.conflictAt = new Date(this.nowMs());
    }
    await this.repo.update(row.id, patch);
    if (!ManabloxError.is(error) || !error.key.startsWith('plugins.license.')) {
      this.options.logger.error({ err: error, keyId: row.keyId }, 'license call failed');
    } else {
      this.options.logger.warn(
        { keyId: row.keyId, error: recorded.error.key },
        'license call failed',
      );
    }
    return recorded.error;
  }

  /** The row after a lease came in. */
  private leased(lease: string, refreshSecret: string): LicenseActivationPatch {
    const payload = decodeLease(lease);
    return {
      lease,
      leaseExp: payload ? new Date(payload.exp * 1000) : null,
      refreshSecret: encryptSecret(refreshSecret, this.options.secret),
      refreshedAt: new Date(this.nowMs()),
      lastError: null,
      failures: 0,
      retryAt: null,
      conflictAt: null,
      deactivatedAt: null,
    };
  }

  /** `<admin or first public hostname> (<first 6 characters of the instance id>)`. */
  private defaultName(instanceId: string, hostnames: readonly string[]): string | undefined {
    const devHosts = this.options.config.devHosts;
    const host =
      this.options.adminHostname ||
      hostnames.find((entry) => entry && !isPrivateHostname(entry, devHosts));
    return host ? `${host} (${instanceId.slice(0, 6)})` : undefined;
  }

  /** Activates a row's key; records and rethrows a failure. */
  private async activateRow(
    row: LicenseActivationRow,
    options: ActivationOptions = {},
  ): Promise<void> {
    try {
      // An admin key that no longer decrypts (another AUTH_SECRET) is recorded like a failure.
      const key = this.keyOf(row);
      if (!key) throw licenseError('plugins.license.key.notFound');
      const [facts, kind] = await Promise.all([
        this.facts(),
        options.kind ?? this.activationKind(),
      ]);
      const instanceId = this.options.instanceId();
      const name = options.name ?? this.defaultName(instanceId, facts.hostnames);
      const activated = await this.client.activate({
        key,
        instanceId,
        kind,
        ...facts,
        ...(name ? { name } : {}),
      });
      await this.repo.update(row.id, {
        activationId: activated.activationId,
        kind: activated.kind,
        ...this.leased(activated.lease, activated.refreshSecret),
      });
    } catch (error) {
      await this.failed(row, error);
      throw error;
    }
  }

  /** Refreshes a row's lease with its refresh secret; records and rethrows a failure. */
  private async refreshRow(row: LicenseActivationRow): Promise<void> {
    if (!row.activationId || !row.refreshSecret) {
      throw licenseError('plugins.license.key.notActivated');
    }
    try {
      const refreshed = await this.client.refresh(row.activationId, {
        refreshSecret: decryptSecret(row.refreshSecret, this.options.secret),
        ...(await this.facts()),
      });
      await this.repo.update(row.id, this.leased(refreshed.lease, refreshed.refreshSecret));
    } catch (error) {
      await this.failed(row, error);
      // The license server no longer knows the activation: its lease covers nothing from now
      // on. The key stays, and activating it again gets a new one.
      if (ManabloxError.is(error) && error.key === 'plugins.license.activation.notFound') {
        await this.repo.update(row.id, UNLEASED);
      }
      throw error;
    }
  }

  /** Frees the row's activation on the license server; one it no longer knows is freed too. */
  private async release(row: LicenseActivationRow): Promise<void> {
    if (!row.activationId) return;
    const proof = row.refreshSecret
      ? { refreshSecret: decryptSecret(row.refreshSecret, this.options.secret) }
      : { key: this.keyOf(row) ?? '' };
    try {
      await this.client.deactivate(row.activationId, proof);
    } catch (error) {
      if (ManabloxError.is(error) && error.key === 'plugins.license.activation.notFound') return;
      throw error;
    }
  }

  private due(row: LicenseActivationRow): boolean {
    if (!row.activationId || !row.refreshSecret || !this.retries(row)) return false;
    const now = this.nowMs();
    const refreshed = row.refreshedAt?.getTime() ?? 0;
    const ends = row.leaseExp?.getTime() ?? 0;
    return now - refreshed >= REFRESH_AFTER_MS || ends - now <= REFRESH_BEFORE_END_MS;
  }

  /**
   * Brings the rows in line with the keys: adds and activates the config's keys, activates
   * the admin's that have no activation yet, and deactivates keys that left the config, at
   * once here and on the license server as far as it answers. Failures are recorded on their
   * row, never thrown.
   */
  reconcile(): Promise<void> {
    return this.write(() => this.reconcileLocked());
  }

  private async reconcileLocked(): Promise<void> {
    const { config } = this.options;
    for (const raw of config.malformed) {
      this.options.logger.warn({ key: `${raw.slice(0, 9)}...` }, 'malformed license key ignored');
    }
    const configured = new Map(config.keys.map((key) => [sha256(key), key]));
    const rows = await this.repo.list();
    const known = new Set(rows.map((row) => row.keyHash));
    for (const [keyHash, key] of configured) {
      if (known.has(keyHash)) continue;
      rows.push(await this.repo.insert({ source: 'environment', keyId: keyId(key), keyHash }));
    }
    for (const row of rows) {
      if (row.source === 'environment' && !configured.has(row.keyHash)) {
        try {
          await this.release(row);
        } catch (error) {
          this.options.logger.warn(
            { keyId: row.keyId, error: ManabloxError.is(error) ? error.key : String(error) },
            'license activation of a removed key not freed on the license server',
          );
        }
        await this.repo.remove(row.id);
        continue;
      }
      if (row.activationId || !this.retries(row)) continue;
      await this.activateRow(row).catch(() => undefined);
    }
  }

  /** The maintenance task: reconciles, then refreshes the leases that are due. */
  maintain(): Promise<void> {
    return this.write(async () => {
      await this.reconcileLocked();
      for (const row of await this.repo.list()) {
        if (this.due(row)) await this.refreshRow(row).catch(() => undefined);
      }
    });
  }

  private async rowOf(id: string): Promise<LicenseActivationRow> {
    const row = await this.repo.findById(id);
    if (!row) throw licenseError('plugins.license.key.notFound');
    return row;
  }

  /** Refreshes one key now, whatever its backoff; one without an activation is activated. */
  refresh(id: string): Promise<LicenseKeyView> {
    return this.write(async () => {
      const row = await this.rowOf(id);
      if (row.activationId) await this.refreshRow(row);
      else await this.activateRow(row);
      return this.viewOf(id);
    });
  }

  /**
   * Activates one key again, e.g. after a conflict or a deactivation; `options` override the
   * configured kind and the instance's name for this call.
   */
  activate(id: string, options: ActivationOptions = {}): Promise<LicenseKeyView> {
    return this.write(async () => {
      const row = await this.rowOf(id);
      await this.activateRow(row, options);
      const view = await this.viewOf(id);
      await this.audit().record('license.key.activate', { ...row, spaceId: null });
      return view;
    });
  }

  /**
   * Frees the key's activation on the license server and drops its lease here; its products
   * lock unless another key covers them. The key stays and is not activated again on its own.
   */
  deactivate(id: string): Promise<LicenseKeyView> {
    return this.write(async () => {
      const row = await this.rowOf(id);
      await this.release(row);
      await this.repo.update(row.id, {
        ...UNLEASED,
        lastError: null,
        failures: 0,
        retryAt: null,
        deactivatedAt: new Date(this.nowMs()),
      });
      await this.audit().record('license.key.deactivate', { ...row, spaceId: null });
      return this.viewOf(id);
    });
  }

  /**
   * Adds a key in the admin, stored encrypted beside the environment's, and activates it. A
   * failed activation keeps the key; its view carries the error.
   */
  addKey(input: string): Promise<LicenseKeyView> {
    const key = parseLicenseKey(input);
    if (!key) throw licenseError('plugins.license.key.malformed');
    const keyHash = sha256(key);
    return this.write(async () => {
      if (await this.repo.findByHash(keyHash)) throw licenseError('plugins.license.key.duplicate');
      const row = await this.repo.insert({
        source: 'admin',
        keyId: keyId(key),
        keyHash,
        keyEnc: encryptSecret(key, this.options.secret),
      });
      await this.audit().record('license.key.add', { ...row, spaceId: null });
      await this.activateRow(row).catch(() => undefined);
      return this.viewOf(row.id);
    });
  }

  /** Removes a key added in the admin, freeing its activation as far as the server answers. */
  removeKey(id: string): Promise<void> {
    return this.write(async () => {
      const row = await this.rowOf(id);
      if (row.source !== 'admin') throw licenseError('plugins.license.key.fromEnvironment');
      try {
        await this.release(row);
      } catch (error) {
        this.options.logger.warn(
          { keyId: row.keyId, error: ManabloxError.is(error) ? error.key : String(error) },
          'license activation of a removed key not freed on the license server',
        );
      }
      await this.repo.remove(row.id);
      await this.audit().record('license.key.remove', { ...row, spaceId: null });
    });
  }

  /**
   * A key the CLI just wrote to the environment (`manablox license add`): this process's key
   * list gains it, so a reconcile keeps it, and it is activated unless it is already, as
   * `options.kind` when that differs. A failed activation keeps the key; its view carries
   * the error. A key stored from the admin is activated the same way.
   */
  addEnvironmentKey(input: string, options: ActivationOptions = {}): Promise<LicenseKeyView> {
    const key = parseLicenseKey(input);
    if (!key) throw licenseError('plugins.license.key.malformed');
    const keyHash = sha256(key);
    return this.write(async () => {
      const { keys } = this.options.config;
      if (!keys.includes(key)) keys.push(key);
      const row =
        (await this.repo.findByHash(keyHash)) ??
        (await this.repo.insert({ source: 'environment', keyId: keyId(key), keyHash }));
      const current = row.activationId !== null && row.deactivatedAt === null;
      const kindChanged = options.kind !== undefined && row.kind !== options.kind;
      if (!current || kindChanged || row.conflictAt) {
        await this.activateRow(row, options).catch(() => undefined);
      }
      return this.viewOf(row.id);
    });
  }

  /**
   * Takes a key out of the environment (`manablox license remove`): frees its activation as
   * far as the server answers, removes its row and drops it from this process's key list.
   */
  removeEnvironmentKey(id: string): Promise<void> {
    return this.write(async () => {
      const row = await this.rowOf(id);
      if (row.source !== 'environment') throw licenseError('plugins.license.key.notFound');
      try {
        await this.release(row);
      } catch (error) {
        this.options.logger.warn(
          { keyId: row.keyId, error: ManabloxError.is(error) ? error.key : String(error) },
          'license activation of a removed key not freed on the license server',
        );
      }
      const { keys } = this.options.config;
      const index = keys.findIndex((key) => sha256(key) === row.keyHash);
      if (index >= 0) keys.splice(index, 1);
      await this.repo.remove(row.id);
    });
  }

  /**
   * Frees a production seat another instance holds of this key, proven by the key itself:
   * the CLI's way out of `noSeats` without the portal. `activationId` is one of the seat
   * holders the error listed.
   */
  async freeSeat(id: string, activationId: string): Promise<void> {
    const row = await this.rowOf(id);
    const key = this.keyOf(row);
    if (!key) throw licenseError('plugins.license.key.notFound');
    await this.client.deactivate(activationId, { key });
    await this.audit().record('license.key.freeSeat', { ...row, spaceId: null });
  }

  private async viewOf(id: string): Promise<LicenseKeyView> {
    const row = await this.rowOf(id);
    const checked = checkLease(
      {
        rowId: row.id,
        token: row.lease,
        refreshFailed: row.lastError !== null,
        conflict: row.conflictAt !== null,
      },
      {
        now: Math.floor(this.nowMs() / 1000),
        instanceId: this.options.instanceId(),
        trustedKeys: this.options.config.trustedKeys,
      },
    );
    return this.view({ row, checked });
  }

  private audit() {
    return auditor(
      this.options.repos,
      LICENSE_KEY_ENTITY,
      (row: LicenseActivationRow & { spaceId: null }) => row.keyId,
      { meta: (row) => ({ source: row.source }) },
    );
  }
}

const EMPTY: Evaluation = {
  keys: [],
  entitlements: new Map(),
  features: new Map(),
  banners: [],
  due: null,
  fingerprint: '',
};

/** A failure as a row keeps it, and the wait the license server asked for. */
function errorOf(error: unknown): { error: LicenseKeyError; retryAfter?: unknown } {
  if (!ManabloxError.is(error) || !error.key.startsWith('plugins.license.')) {
    return { error: { key: 'plugins.license.server.failed', message: 'The license call failed.' } };
  }
  const params = error.details[0]?.params ?? {};
  const recorded: LicenseKeyError = { key: error.key, message: licenseMessage(error.key, params) };
  if (Array.isArray(params.activations)) {
    recorded.activations = params.activations as LicenseSeatHolder[];
  }
  return { error: recorded, retryAfter: params.retryAfter };
}
