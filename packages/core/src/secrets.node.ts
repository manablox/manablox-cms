import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { ManabloxError } from './errors.js';

/**
 * Secrets at rest (AI keys, credentials): AES-256-GCM keyed from the instance
 * secret, stored as base64url `<version>.<iv>.<tag>.<ciphertext>`. Losing the instance
 * secret loses these values by design.
 * The key is derived with HKDF, so it never equals a signing key from the same secret.
 */
const CURRENT = 'v2';

/** Domain separation from other uses of the instance secret. */
const INFO = 'manablox:secrets:v2';

/** Fixed salt: the input is one long-lived secret, not a guessable password. */
const SALT = Buffer.from('manablox:secrets');

function keyFrom(secret: string): Buffer {
  if (!secret) throw ManabloxError.badRequest('secret.keyMissing');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, INFO, 32));
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    CURRENT,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string, secret: string): string {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== CURRENT || !iv || !tag || !body) {
    throw ManabloxError.badRequest('secret.undecryptable');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // A wrong secret and a tampered value are the same failure from here.
    throw ManabloxError.badRequest('secret.undecryptable');
  }
}

/** The last four characters, to identify a key in a form. */
export function secretHint(plaintext: string): string {
  return plaintext.slice(-4);
}
