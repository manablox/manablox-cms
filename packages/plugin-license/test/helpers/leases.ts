import { generateSigningKeyPair, type LeasePayload, signLease } from '@manablox/license';

/** A signing key of the tests only; the plugin trusts it through `trustedKeys`. */
export const TEST_KID = 'test-plugin-license';
const pair = generateSigningKeyPair();
export const TEST_PRIVATE_KEY = pair.privateKey;
export const TRUSTED_KEYS: Readonly<Record<string, string>> = { [TEST_KID]: pair.publicKey };

/** Another key nobody trusts. */
const stranger = generateSigningKeyPair();

export const DAY = 24 * 60 * 60;
/** The tests' "now", unix seconds. */
export const T0 = Date.parse('2026-10-01T12:00:00.000Z') / 1000;
export const INSTANCE_ID = '0192f0c4-0000-7000-8000-000000000001';

/** A lease as the license server issues it at `T0`: active for a month, both products. */
function leasePayload(overrides: Partial<LeasePayload> = {}): LeasePayload {
  return {
    v: 1,
    kid: TEST_KID,
    iss: 'licenses.manablox.io',
    aid: 'act-1',
    iid: INSTANCE_ID,
    key: 'J06NP',
    products: ['ai', 'website'],
    kind: 'production',
    status: 'active',
    periodEnd: T0 + 30 * DAY,
    iat: T0,
    nbf: T0,
    exp: T0 + 14 * DAY,
    ...overrides,
  };
}

export function lease(overrides: Partial<LeasePayload> = {}): string {
  return signLease(leasePayload(overrides), TEST_PRIVATE_KEY);
}

/** Signed by an untrusted key under the trusted kid. */
export function forgedLease(overrides: Partial<LeasePayload> = {}): string {
  return signLease(leasePayload(overrides), stranger.privateKey);
}
