import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { SignatureAlgorithm, SignatureFormat } from './signature.js';

const SALT = Buffer.from('manablox:signing');

const keys = new Map<string, Buffer>();

/** A key for one purpose (`info`, e.g. `manablox:site-share`), derived from the instance secret. */
export function signingKey(secret: string, info: string): Buffer {
  const id = `${info}\n${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, info, 32));
    keys.set(id, key);
  }
  return key;
}

/** HMAC-SHA256 of `data` under the purpose's key, base64url. */
export function signFor(secret: string, info: string, data: string): string {
  return createHmac('sha256', signingKey(secret, info)).update(data).digest('base64url');
}

/** Whether two signatures or secrets match, in constant time that also hides their length. */
export function sameSignature(expected: string, actual: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(actual).digest();
  return timingSafeEqual(a, b);
}

/**
 * The HMAC of a request body under a shared secret. Manablox's own format, the default, is
 * `sha256=<hex digest>` of the raw body, sent as `X-Manablox-Signature`; the algorithm and
 * format are options for services that expect another.
 */
export function signBody(
  secret: string,
  body: string,
  options: { algorithm?: SignatureAlgorithm; format?: SignatureFormat } = {},
): string {
  const algorithm = options.algorithm ?? 'sha256';
  const hmac = createHmac(algorithm, secret).update(body);
  switch (options.format ?? 'prefixed') {
    case 'base64':
      return hmac.digest('base64');
    case 'hex':
      return hmac.digest('hex');
    case 'prefixed':
      return `${algorithm}=${hmac.digest('hex')}`;
  }
}
