import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';
import { PREMIUM_PRODUCT_IDS } from './products.js';
import { LICENSE_PUBLIC_KEYS } from './public-keys.js';

/**
 * A lease: `base64url(payload JSON) + '.' + base64url(Ed25519 signature of those bytes)`.
 * The license server issues one per activation and the instance verifies it offline.
 */
export const leasePayloadSchema = z.object({
  v: z.literal(1),
  /** Signing key id, for rotation. */
  kid: z.string().min(1),
  iss: z.literal('licenses.manablox.io'),
  /** Activation id. */
  aid: z.string().min(1),
  /** Instance id. */
  iid: z.string().min(1),
  /** Key id, the key's first group. */
  key: z.string().min(1),
  products: z.array(z.enum(PREMIUM_PRODUCT_IDS)),
  kind: z.enum(['production', 'development', 'hosted']),
  status: z.enum(['active', 'trialing', 'pastDue', 'canceled']),
  /** End of the paid or trial period, unix seconds. */
  periodEnd: z.int().nonnegative(),
  iat: z.int().nonnegative(),
  /** Valid from this second on. */
  nbf: z.int().nonnegative(),
  /** Valid before this second. */
  exp: z.int().nonnegative(),
});

export type LeasePayload = z.infer<typeof leasePayloadSchema>;

export type LeaseRejection =
  | 'malformed'
  | 'unknownKid'
  | 'badSignature'
  | 'notYetValid'
  | 'expired';

export type LeaseVerification =
  | { ok: true; lease: LeasePayload }
  | { ok: false; reason: LeaseRejection };

/** Signs a lease. For the license server; `privateKey` is a PKCS#8 PEM or a key object. */
export function signLease(payload: LeasePayload, privateKey: string | KeyObject): string {
  const bytes = Buffer.from(JSON.stringify(leasePayloadSchema.parse(payload)));
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  return `${bytes.toString('base64url')}.${sign(null, bytes, key).toString('base64url')}`;
}

/**
 * Verifies a lease against the trusted keys (by `kid`) at `now` (unix seconds): the
 * signature, the payload's version and shape, `nbf` and `exp`.
 */
export function verifyLease(
  token: string,
  publicKeys: Readonly<Record<string, string>> = LICENSE_PUBLIC_KEYS,
  now: number = Math.floor(Date.now() / 1000),
): LeaseVerification {
  const [body, signed, ...rest] = token.split('.');
  if (body === undefined || signed === undefined || rest.length > 0)
    return { ok: false, reason: 'malformed' };
  const bytes = Buffer.from(body, 'base64url');
  const signature = Buffer.from(signed, 'base64url');

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const kid = (raw as { kid?: unknown } | null)?.kid;
  if (typeof kid !== 'string') return { ok: false, reason: 'malformed' };
  const publicKey = Object.hasOwn(publicKeys, kid) ? publicKeys[kid] : undefined;
  if (!publicKey) return { ok: false, reason: 'unknownKid' };
  if (!signedBy(bytes, signature, publicKey)) return { ok: false, reason: 'badSignature' };

  const parsed = leasePayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  if (now < parsed.data.nbf) return { ok: false, reason: 'notYetValid' };
  if (now >= parsed.data.exp) return { ok: false, reason: 'expired' };
  return { ok: true, lease: parsed.data };
}

/**
 * A new signing key pair, for the license server's key tooling: the public key in the form
 * `LICENSE_PUBLIC_KEYS` holds it, the private key as a PKCS#8 PEM.
 */
export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'jwk' }).x as string,
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  };
}

/** False for a wrong signature, and for a signature or key of the wrong length. */
function signedBy(bytes: Buffer, signature: Buffer, x: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
    return verify(null, bytes, key, signature);
  } catch {
    return false;
  }
}
