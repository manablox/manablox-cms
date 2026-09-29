import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateSamlKeys } from '../src/saml-keys.js';

// Serial bytes under test; the rest of node:crypto stays real.
const serialBytes = vi.hoisted(() => ({ next: null as Buffer | null }));
vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof crypto>();
  return {
    ...actual,
    randomBytes: (size: number) => serialBytes.next ?? actual.randomBytes(size),
  };
});

describe('generateSamlKeys', () => {
  it.each([
    ['all zero', Buffer.alloc(16)],
    ['a zero byte before a small one', Buffer.from('00123456789abcdef0123456789abcde', 'hex')],
    ['a high first byte', Buffer.alloc(16, 0xff)],
  ])('makes a certificate OpenSSL parses from serial bytes with %s', async (_, bytes) => {
    serialBytes.next = bytes;
    try {
      const { certificate, privateKey } = await generateSamlKeys('corp.test');
      const parsed = new crypto.X509Certificate(certificate);
      expect(parsed.subject).toBe('CN=corp.test');
      expect(parsed.checkPrivateKey(crypto.createPrivateKey(privateKey))).toBe(true);
      // A positive serial without padding.
      expect(parsed.serialNumber).toMatch(/^[4-7][0-9A-F]{31}$/);
    } finally {
      serialBytes.next = null;
    }
  });
});
