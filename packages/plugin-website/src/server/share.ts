import { sameSignature, signFor } from '@manablox/core/node';

/**
 * What a site share link grants: draft preview of a space environment, or of one document
 * in it. Without `environmentId` the space's production environment.
 */
export interface SiteSharePayload {
  spaceId: string;
  environmentId?: string | undefined;
  contentId?: string | undefined;
  expiresAt: Date;
}

const INFO = 'manablox:site-share';

const signature = (secret: string, body: string) => signFor(secret, INFO, body);

/**
 * `<body>.<signature>`, both base64url; the body is `{ s, n?, c?, e }` with `n` the
 * environment and `e` in epoch seconds.
 */
export function signSiteShare(secret: string, payload: SiteSharePayload): string {
  const claims: Record<string, unknown> = { s: payload.spaceId };
  if (payload.environmentId) claims.n = payload.environmentId;
  if (payload.contentId) claims.c = payload.contentId;
  claims.e = Math.floor(payload.expiresAt.getTime() / 1000);
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${signature(secret, body)}`;
}

/** The payload of a valid, unexpired token; `null` otherwise. */
export function verifySiteShare(
  secret: string,
  token: string,
  now: Date = new Date(),
): SiteSharePayload | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!sameSignature(signature(secret, body), sig)) return null;
  let claims: { s?: unknown; n?: unknown; c?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.s !== 'string' || typeof claims.e !== 'number') return null;
  if (claims.c !== undefined && typeof claims.c !== 'string') return null;
  if (claims.n !== undefined && typeof claims.n !== 'string') return null;
  const expiresAt = new Date(claims.e * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return {
    spaceId: claims.s,
    ...(typeof claims.n === 'string' ? { environmentId: claims.n } : {}),
    ...(typeof claims.c === 'string' ? { contentId: claims.c } : {}),
    expiresAt,
  };
}
