/**
 * `@manablox/plugin-license/testing`: a license plugin for tests and local end-to-end runs
 * that grants itself a lease, signed with a key pair the caller generates and it alone
 * trusts. Never for a real instance.
 */

import { createHash } from 'node:crypto';
import { definePlugin, type ManabloxPlugin, onHook } from '@manablox/core';
import { encryptSecret } from '@manablox/core/node';
import {
  generateSigningKeyPair,
  keyId,
  type LeasePayload,
  PREMIUM_PRODUCT_IDS,
  type PremiumProduct,
  signLease,
} from '@manablox/license';
import type { LicenseKind } from './sdk.js';
import type { LicensePluginOptions } from './server/config.js';
import { licenseRepos } from './server/db/index.js';
import { licensePlugin } from './server/plugin.js';
import type { LicenseServices } from './server/services/index.js';

/** A lease signing key pair for tests: `signingKey` signs, `publicKey` verifies, by `kid`. */
export interface TestSigningKeys {
  kid: string;
  /** The Ed25519 private key, PKCS#8 PEM. */
  signingKey: string;
  /** The raw Ed25519 public key, base64url, as `trustedKeys` holds it. */
  publicKey: string;
}

/**
 * A fresh key pair, generated at runtime. Generate one per test run (or per process that
 * boots an instance) and hand the same pair to every `testLicensePlugin` of one instance.
 */
export function generateTestSigningKeys(kid = 'manablox-test'): TestSigningKeys {
  const { publicKey, privateKey } = generateSigningKeyPair();
  return { kid, signingKey: privateKey, publicKey };
}

/** The environment variable `signingToEnv` sets and `signingFromEnv` reads. */
export const TEST_LICENSE_SIGNING_ENV = 'MANABLOX_TEST_LICENSE_SIGNING';

/**
 * `keys` as environment variables, for handing one pair to the other processes of an
 * instance (a child process, a web server a test runner starts): `{ MANABLOX_TEST_LICENSE_SIGNING }`,
 * the pair as base64url JSON.
 */
export function signingToEnv(keys: TestSigningKeys): Record<string, string> {
  const { kid, signingKey, publicKey } = keys;
  const json = JSON.stringify({ kid, signingKey, publicKey });
  return { [TEST_LICENSE_SIGNING_ENV]: Buffer.from(json).toString('base64url') };
}

/**
 * The pair `signingToEnv` put into `env`: `MANABLOX_TEST_LICENSE_SIGNING` as base64url JSON
 * or plain JSON. Throws when it is missing or not a key pair. Nothing reads the variable
 * unless a process calls this, e.g. `testLicensePlugin({ signing: signingFromEnv() })`.
 */
export function signingFromEnv(
  env: Record<string, string | undefined> = process.env,
): TestSigningKeys {
  const value = env[TEST_LICENSE_SIGNING_ENV]?.trim();
  if (!value) throw new Error(`${TEST_LICENSE_SIGNING_ENV} is not set`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      value.startsWith('{') ? value : Buffer.from(value, 'base64url').toString('utf8'),
    );
  } catch {
    throw new Error(`${TEST_LICENSE_SIGNING_ENV} is neither JSON nor base64url JSON`);
  }
  const keys = parsed as Partial<TestSigningKeys> | null;
  if (
    typeof keys?.kid !== 'string' ||
    typeof keys.signingKey !== 'string' ||
    typeof keys.publicKey !== 'string'
  ) {
    throw new Error(`${TEST_LICENSE_SIGNING_ENV} needs kid, signingKey and publicKey`);
  }
  return { kid: keys.kid, signingKey: keys.signingKey, publicKey: keys.publicKey };
}

/** The license key the granted lease belongs to; not a key the license server knows. */
const TEST_LICENSE_KEY = 'MBX-0KB84-X6NY9-NT3YS-1QQPF-Z5NEB';

/** The license server the test plugin names; it is never called. */
const TEST_SERVER = 'https://licenses.test/api';

const DAY_SECONDS = 24 * 60 * 60;

/** The lease `testLicensePlugin` grants. */
export interface TestLicenseGrant {
  /** Both products by default. */
  products?: readonly PremiumProduct[];
  /** `production` by default. */
  kind?: LicenseKind;
  status?: LeasePayload['status'];
  /** Days until the lease runs out; a year by default. */
  days?: number;
}

export interface TestLicenseOptions extends LicensePluginOptions {
  /** The key pair the granted lease is signed with and the plugin trusts. */
  signing: TestSigningKeys;
  /** The lease to grant at boot; `false` grants none, so the premium products lock. */
  grant?: TestLicenseGrant | false;
}

/** A lease for `instanceId`, signed with `signing`. */
function testLease(instanceId: string, signing: TestSigningKeys, grant: TestLicenseGrant): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (grant.days ?? 365) * DAY_SECONDS;
  return signLease(
    {
      v: 1,
      kid: signing.kid,
      iss: 'licenses.manablox.io',
      aid: 'test-activation',
      iid: instanceId,
      key: keyId(TEST_LICENSE_KEY),
      products: [...(grant.products ?? PREMIUM_PRODUCT_IDS)],
      kind: grant.kind ?? 'production',
      status: grant.status ?? 'active',
      periodEnd: exp,
      iat,
      nbf: iat,
      exp,
    },
    signing.signingKey,
  );
}

/**
 * `licensePlugin` for tests: it trusts `signing`, calls no license server and, before it
 * reads the leases in each process, stores `grant` as an activated key of the instance
 * (replacing an earlier grant). Every process of the instance can load it. Its `kind` is
 * `production` unless given, so the grant alone decides: pass `kind: 'auto'` or
 * `'development'` to test a development instance, whose products run without a lease.
 */
export function testLicensePlugin(options: TestLicenseOptions): ManabloxPlugin<LicenseServices> {
  const { grant = {}, signing, ...rest } = options;
  const plugin = licensePlugin({
    server: TEST_SERVER,
    keys: [],
    fetch: async () => Response.json({ error: { code: 'offline' } }, { status: 503 }),
    // Tests run on localhost outside production: `auto` would unlock every product as a
    // development instance, whatever the grant.
    kind: 'production',
    ...rest,
    trustedKeys: { ...rest.trustedKeys, [signing.kid]: signing.publicKey },
  });
  const hooks = plugin.hooks;
  return definePlugin<LicenseServices>({
    ...plugin,
    hooks: (context) => [
      onHook('before:start', async () => {
        const repo = licenseRepos(context.repos);
        const keyHash = createHash('sha256').update(TEST_LICENSE_KEY).digest('hex');
        const found = await repo.findByHash(keyHash);
        if (grant === false) {
          if (found) await repo.remove(found.id);
          return;
        }
        const { secret } = context.manablox.config.auth;
        const lease = testLease(context.manablox.instance.id, signing, grant);
        const leased = {
          activationId: 'test-activation',
          kind: grant.kind ?? 'production',
          lease,
          leaseExp: new Date(Date.now() + (grant.days ?? 365) * DAY_SECONDS * 1000),
          refreshSecret: encryptSecret('test-refresh-secret', secret),
          refreshedAt: new Date(),
          lastError: null,
        } as const;
        if (found) {
          await repo.update(found.id, leased);
          return;
        }
        try {
          await repo.insert({
            source: 'admin',
            keyId: keyId(TEST_LICENSE_KEY),
            keyHash,
            keyEnc: encryptSecret(TEST_LICENSE_KEY, secret),
            ...leased,
          });
        } catch (error) {
          // Another process of the instance, started at the same moment, stored it first
          // (the key hash is unique); this one's grant replaces it.
          const stored = await repo.findByHash(keyHash);
          if (!stored) throw error;
          await repo.update(stored.id, leased);
        }
      }),
      ...(hooks?.(context) ?? []),
    ],
  });
}
