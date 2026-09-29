import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, type ManabloxConfig, type ManabloxPlugin } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import type { Hono } from 'hono';
import type { LicensePluginOptions } from '../../src/server/config.js';
import { licensePlugin } from '../../src/server/plugin.js';
import type { LicenseServices } from '../../src/server/services/index.js';
import { FAKE_SERVER, type FakeLicenseServer, fakeLicenseServer } from './fake-server.js';
import { T0, TRUSTED_KEYS } from './leases.js';

/**
 * A plugin that sells the `ai` product, as a paid plugin will: its `design` feature is the
 * lapse set, so it locks without a license while the plugin itself stays on.
 */
const sellerPlugin = () =>
  definePlugin({
    name: 'seller',
    enhances: ['license'],
    controls: { 'features.plugins.seller.design': { description: 'Designing things.' } },
    contributions: {
      license: { products: [{ product: 'ai', lapse: ['plugins.seller.design'] }] },
    },
  });

export const SELLER_LAPSE = 'plugins.seller.design' as const;

export interface LicenseInstance {
  db: TestDatabase;
  api: ManagementRuntime;
  app: Hono;
  /** A public process on the same database, when asked for. */
  pub: Runtime | null;
  server: FakeLicenseServer;
  /** Milliseconds; move it to move time for the plugin and the fake server. */
  clock: { now: number };
  services: (runtime?: Runtime) => LicenseServices;
  /** Boots the management process again on the same database, with other plugin options. */
  restart: (license: (server: FakeLicenseServer) => LicensePluginOptions) => Promise<void>;
  close: () => Promise<void>;
}

export interface BootOptions {
  /** The plugin's options over the fake server, clock and test key. */
  license?: (server: FakeLicenseServer) => LicensePluginOptions;
  config?: Partial<ManabloxConfig>;
  plugins?: ManabloxPlugin[];
  /** Also boots a public process. */
  public?: boolean;
}

/** A management instance with the license plugin and the seller, against a fake license server. */
export async function bootLicense(
  name: string,
  options: BootOptions = {},
): Promise<LicenseInstance> {
  const clock = { now: T0 * 1000 };
  const server = fakeLicenseServer(clock);
  const pluginsWith = (license: BootOptions['license']) => [
    licensePlugin({
      server: FAKE_SERVER,
      trustedKeys: TRUSTED_KEYS,
      fetch: server.fetch,
      now: () => clock.now,
      keys: [],
      ...license?.(server),
    }),
    ...(options.plugins ?? [sellerPlugin()]),
  ];
  const plugins = pluginsWith(options.license);
  const db = await createTestDatabase(name, { plugins });
  const dir = await mkdtemp(join(tmpdir(), 'manablox-license-'));
  const configOf = (list: ManabloxPlugin[]): ManabloxConfig => ({
    database: { url: db.url },
    auth: { secret: 'license-plugin-secret-0123456789' },
    fieldTypes: [],
    contentTypes: [],
    logLevel: 'fatal',
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
    plugins: list,
    ...options.config,
  });
  const management = async (list: ManabloxPlugin[]) => {
    const config = configOf(list);
    return requireManagement(
      await bootstrap({
        ...config,
        server: { rateLimit: false, scopes: ['rpc', 'auth'], ...config.server },
      }),
    );
  };
  const instance: LicenseInstance = {
    db,
    api: await management(plugins),
    app: undefined as unknown as Hono,
    pub: null,
    server,
    clock,
    services: (runtime = instance.api) =>
      runtime.manablox.plugin<LicenseServices>('license').services,
    restart: async (license) => {
      await instance.api.shutdown();
      instance.api = await management(pluginsWith(license));
      instance.app = await createApp(instance.api);
    },
    close: async () => {
      await instance.pub?.shutdown();
      await instance.api.shutdown();
      await db.drop();
      await rm(dir, { recursive: true, force: true });
    },
  };
  instance.app = await createApp(instance.api);
  if (options.public) {
    const config = configOf(plugins);
    instance.pub = await bootstrap({
      ...config,
      server: { ...config.server, mode: 'public', rateLimit: false },
    });
  }
  return instance;
}
