import { createDecipheriv, createHash } from 'node:crypto';
import { ManabloxError } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, secretHint } from '../src/server/secrets.js';

const SECRET = 'an instance secret, long enough to be one';

describe('provider key storage', () => {
  it('round-trips a key', () => {
    const stored = encryptSecret('sk-ant-abc123', SECRET);
    expect(stored).not.toContain('sk-ant');
    expect(decryptSecret(stored, SECRET)).toBe('sk-ant-abc123');
  });

  it('writes a different ciphertext every time, so two spaces with one key do not match', () => {
    expect(encryptSecret('same-key', SECRET)).not.toBe(encryptSecret('same-key', SECRET));
  });

  it('refuses a key stored under another secret', () => {
    const stored = encryptSecret('sk-ant-abc123', SECRET);
    expect(() => decryptSecret(stored, 'a different secret')).toThrow(ManabloxError);
  });

  it('refuses a tampered value rather than returning half of it', () => {
    const [version, iv, tag, body] = encryptSecret('sk-ant-abc123', SECRET).split('.');
    const bytes = Buffer.from(body as string, 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 0x01;
    const flipped = bytes.toString('base64url');
    expect(() => decryptSecret([version, iv, tag, flipped].join('.'), SECRET)).toThrow(
      ManabloxError,
    );
    expect(() => decryptSecret('not-even-close', SECRET)).toThrow(ManabloxError);
  });

  it('refuses to store anything without an instance secret', () => {
    expect(() => encryptSecret('sk-ant-abc123', '')).toThrow(ManabloxError);
  });

  it('hints at a key by its last four characters', () => {
    expect(secretHint('sk-ant-api03-xyz789')).toBe('z789');
  });
});

describe('key derivation versions', () => {
  it('writes v2', () => {
    expect(encryptSecret('sk-ant-abc123', SECRET).startsWith('v2.')).toBe(true);
  });

  it('derives a different key than a bare hash of the instance secret', () => {
    // The key must differ from a bare hash of the same secret.
    const stored = encryptSecret('sk-ant-abc123', SECRET);
    const [, iv, tag, body] = stored.split('.');
    const bare = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(SECRET).digest(),
      Buffer.from(iv as string, 'base64url'),
    );
    bare.setAuthTag(Buffer.from(tag as string, 'base64url'));
    expect(() =>
      Buffer.concat([bare.update(Buffer.from(body as string, 'base64url')), bare.final()]),
    ).toThrow();
  });

  it('refuses a version it does not know', () => {
    const stored = encryptSecret('sk-ant-abc123', SECRET);
    expect(() => decryptSecret(stored.replace(/^v2\./, 'v9.'), SECRET)).toThrow(ManabloxError);
  });
});
