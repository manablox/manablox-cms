import { createPrivateKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateSigningKeyPair,
  type LeasePayload,
  LICENSE_PUBLIC_KEYS,
  signLease,
  verifyLease,
} from '../src/index.js';
import { DEV_KID, DEV_PRIVATE_KEY, DEV_PUBLIC_KEYS } from './fixtures/dev-signing-key.js';
import { FROZEN_LEASE, FROZEN_PAYLOAD } from './fixtures/lease.js';

const NOW = 1_789_500_000;

function payload(overrides: Partial<LeasePayload> = {}): LeasePayload {
  return { ...FROZEN_PAYLOAD, nbf: NOW - 60, exp: NOW + 3600, ...overrides };
}

/** The token with its payload replaced by `json`, keeping the old signature. */
function withPayload(token: string, json: unknown): string {
  return `${Buffer.from(JSON.stringify(json)).toString('base64url')}.${token.split('.')[1]}`;
}

describe('leases', () => {
  it('does not trust the dev key by default', () => {
    expect(LICENSE_PUBLIC_KEYS).not.toHaveProperty(DEV_KID);
    expect(verifyLease(FROZEN_LEASE, undefined, NOW)).toEqual({ ok: false, reason: 'unknownKid' });
  });

  it('round trips through the dev key', () => {
    const lease = payload();
    expect(verifyLease(signLease(lease, DEV_PRIVATE_KEY), DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: true,
      lease,
    });
  });

  it('verifies the frozen fixture lease, and signs its payload to the same token', () => {
    expect(verifyLease(FROZEN_LEASE, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: true,
      lease: FROZEN_PAYLOAD,
    });
    // Ed25519 signatures are deterministic.
    expect(signLease(FROZEN_PAYLOAD, DEV_PRIVATE_KEY)).toBe(FROZEN_LEASE);
  });

  it('works with a freshly generated key pair', () => {
    const pair = generateSigningKeyPair();
    const token = signLease(payload({ kid: 'next' }), pair.privateKey);
    expect(verifyLease(token, { next: pair.publicKey }, NOW).ok).toBe(true);
    const other = generateSigningKeyPair();
    expect(verifyLease(token, { next: other.publicKey }, NOW)).toEqual({
      ok: false,
      reason: 'badSignature',
    });
  });

  it('rejects a tampered payload or signature', () => {
    const token = signLease(payload(), DEV_PRIVATE_KEY);
    const upgraded = withPayload(token, { ...payload(), exp: NOW + 10 * 365 * 86400 });
    expect(verifyLease(upgraded, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: false,
      reason: 'badSignature',
    });

    const [body = '', signature = ''] = token.split('.');
    const flipped = Buffer.from(signature, 'base64url');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
    expect(verifyLease(`${body}.${flipped.toString('base64url')}`, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: false,
      reason: 'badSignature',
    });
    expect(verifyLease(`${body}.`, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: false,
      reason: 'badSignature',
    });
  });

  it('rejects a kid it does not trust', () => {
    const token = signLease(payload({ kid: 'retired' }), DEV_PRIVATE_KEY);
    expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: false,
      reason: 'unknownKid',
    });
    // Inherited object keys are not key ids.
    const proto = signLease(payload({ kid: 'constructor' }), DEV_PRIVATE_KEY);
    expect(verifyLease(proto, DEV_PUBLIC_KEYS, NOW)).toEqual({
      ok: false,
      reason: 'unknownKid',
    });
  });

  it('is valid from nbf and until just before exp', () => {
    const token = signLease(payload({ nbf: NOW, exp: NOW + 100 }), DEV_PRIVATE_KEY);
    expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW - 1)).toEqual({
      ok: false,
      reason: 'notYetValid',
    });
    expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW).ok).toBe(true);
    expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW + 99).ok).toBe(true);
    expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW + 100)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects malformed tokens and payloads of another version', () => {
    for (const token of [
      '',
      'abc',
      'a.b.c',
      `${Buffer.from('not json').toString('base64url')}.x`,
    ]) {
      expect(verifyLease(token, DEV_PUBLIC_KEYS, NOW)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
    // Signed correctly, but not a v1 payload.
    const bytes = Buffer.from(JSON.stringify({ ...payload(), v: 2 }));
    const signature = sign(null, bytes, createPrivateKey(DEV_PRIVATE_KEY));
    const v2 = `${bytes.toString('base64url')}.${signature.toString('base64url')}`;
    expect(verifyLease(v2, DEV_PUBLIC_KEYS, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses to sign an invalid payload', () => {
    expect(() =>
      signLease({ ...payload(), products: ['blog'] } as unknown as LeasePayload, DEV_PRIVATE_KEY),
    ).toThrow();
  });
});
