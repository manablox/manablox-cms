import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, type ManabloxConfig, type ManabloxPlugin } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { bootstrap, type Runtime } from '@manablox/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { licensePlugin } from '../src/server/plugin.js';
import type { LicenseServices } from '../src/server/services/index.js';
import {
  generateTestSigningKeys,
  signingFromEnv,
  signingToEnv,
  TEST_LICENSE_SIGNING_ENV,
  type TestLicenseGrant,
  testLicensePlugin,
} from '../src/testing.js';

const seller = () =>
  definePlugin({
    name: 'seller',
    requires: ['license'],
    controls: { 'features.plugins.seller.design': { description: 'Designing things.' } },
    contributions: {
      license: { products: [{ product: 'website', lapse: ['plugins.seller.design'] }] },
    },
  });

// One pair for the run; every process of an instance trusts the same one.
const signing = generateTestSigningKeys();

let db: TestDatabase | null = null;
let dir = '';
const runtimes: Runtime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown();
  await db?.drop();
  db = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function boot(grant: TestLicenseGrant | false, mode?: 'public'): Promise<Runtime> {
  return bootWith(testLicensePlugin({ signing, grant }), mode);
}

async function bootWith(license: ManabloxPlugin, mode?: 'public'): Promise<Runtime> {
  const plugins: ManabloxPlugin[] = [license, seller()];
  db ??= await createTestDatabase('license_testing', { plugins });
  dir ||= await mkdtemp(join(tmpdir(), 'manablox-license-testing-'));
  const config: ManabloxConfig = {
    database: { url: db.url },
    auth: { secret: 'license-testing-secret-0123456789' },
    logLevel: 'fatal',
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
    server: { rateLimit: false, ...(mode ? { mode } : {}) },
    plugins,
  };
  const runtime = await bootstrap(config);
  runtimes.push(runtime);
  return runtime;
}

const services = (runtime: Runtime) => runtime.manablox.plugin<LicenseServices>('license').services;
const designOn = async (runtime: Runtime) =>
  (await runtime.manablox.controls.feature(null, 'plugins.seller.design')).enabled;

describe('testLicensePlugin', () => {
  it('grants both products to every process, with no license server', async () => {
    const api = await boot({});
    const pub = await boot({}, 'public');
    for (const runtime of [api, pub]) {
      expect(services(runtime).entitlement('website')).toMatchObject({
        state: 'active',
        kind: 'production',
      });
      expect(await designOn(runtime)).toBe(true);
    }
    expect(api.manablox.ceilings.current().banners).toEqual([]);
  });

  it('grants every process of an instance that starts at the same moment', async () => {
    // The dev stacks start the API and the site process together on a new database: both
    // find no grant stored and both store it.
    db = await createTestDatabase('license_testing', {
      plugins: [testLicensePlugin({ signing }), seller()],
    });
    dir = await mkdtemp(join(tmpdir(), 'manablox-license-testing-'));
    const started = await Promise.all([boot({}), boot({}, 'public'), boot({}, 'public')]);
    for (const runtime of started) {
      expect(services(runtime).entitlement('website').state).toBe('active');
    }
  });

  it('grants nothing with grant false, so the products lock', async () => {
    const api = await boot(false);
    expect(services(api).entitlement('website').state).toBe('missing');
    expect(await designOn(api)).toBe(false);
  });

  it('is a development instance only when asked, which runs without a grant', async () => {
    const api = await bootWith(testLicensePlugin({ signing, grant: false, kind: 'auto' }));
    expect(services(api).entitlement('website').state).toBe('development');
    expect(await designOn(api)).toBe(true);
    expect(services(api).allowsHost('website', 'www.example.com')).toBe(false);
  });

  it('grants a development lease that serves private hosts only', async () => {
    const api = await boot({ kind: 'development', products: ['website'] });
    expect(services(api).entitlement('website').kind).toBe('development');
    expect(services(api).allowsHost('website', 'localhost:3000')).toBe(true);
    expect(services(api).allowsHost('website', 'www.example.com')).toBe(false);
    expect(services(api).entitlement('ai').state).toBe('missing');
  });

  it('distrusts a lease signed with another pair', async () => {
    await boot({});
    // A second instance process with its own pair reads the lease the first one stored.
    const other = generateTestSigningKeys();
    expect(other.publicKey).not.toBe(signing.publicKey);
    const runtime = await bootWith(
      licensePlugin({
        server: 'https://licenses.test/api',
        keys: [],
        fetch: async () => Response.json({ error: { code: 'offline' } }, { status: 503 }),
        trustedKeys: { [other.kid]: other.publicKey },
        // Not a development instance, which would run the product without a lease.
        kind: 'production',
      }),
    );
    expect(services(runtime).entitlement('website').state).not.toBe('active');
    expect(await designOn(runtime)).toBe(false);
  });
});

describe('signingToEnv and signingFromEnv', () => {
  it('carry a pair through the environment, as base64url or plain JSON', () => {
    const env = signingToEnv(signing);
    expect(Object.keys(env)).toEqual([TEST_LICENSE_SIGNING_ENV]);
    expect(env[TEST_LICENSE_SIGNING_ENV]).toMatch(/^[\w-]+$/);
    expect(signingFromEnv(env)).toEqual(signing);
    expect(signingFromEnv({ [TEST_LICENSE_SIGNING_ENV]: JSON.stringify(signing) })).toEqual(
      signing,
    );
  });

  it('read process.env by default', () => {
    vi.stubEnv(TEST_LICENSE_SIGNING_ENV, signingToEnv(signing)[TEST_LICENSE_SIGNING_ENV]);
    expect(signingFromEnv()).toEqual(signing);
  });

  it('refuse a missing variable or one that is not a key pair', () => {
    expect(() => signingFromEnv({})).toThrow(`${TEST_LICENSE_SIGNING_ENV} is not set`);
    expect(() => signingFromEnv({ [TEST_LICENSE_SIGNING_ENV]: '{nope' })).toThrow(
      'neither JSON nor base64url JSON',
    );
    expect(() => signingFromEnv({ [TEST_LICENSE_SIGNING_ENV]: '{"kid":"x"}' })).toThrow(
      'needs kid, signingKey and publicKey',
    );
  });

  it("let another process of the instance trust the first one's lease", async () => {
    await boot({});
    const pub = await bootWith(
      testLicensePlugin({ signing: signingFromEnv(signingToEnv(signing)) }),
      'public',
    );
    expect(services(pub).entitlement('website').state).toBe('active');
  });
});
