import { createHash } from 'node:crypto';
import { sameSignature, signFor } from '@manablox/core/node';

/** What a site access cookie is bound to: the space and its current password hash. */
export interface SiteAccessSubject {
  spaceId: string;
  /** The stored hash; a new password invalidates every earlier cookie. */
  passwordHash: string;
}

const INFO = 'manablox:site-access';

function signature(secret: string, subject: SiteAccessSubject, expires: number): string {
  const fingerprint = createHash('sha256').update(subject.passwordHash).digest('base64url');
  return signFor(secret, INFO, `${subject.spaceId}\n${expires}\n${fingerprint}`);
}

/** `<expires>.<signature>`, `expires` in epoch seconds. */
export function signSiteAccess(
  secret: string,
  subject: SiteAccessSubject,
  expiresAt: Date,
): string {
  const expires = Math.floor(expiresAt.getTime() / 1000);
  return `${expires}.${signature(secret, subject, expires)}`;
}

/** Whether `token` is a valid, unexpired cookie for the space and password. */
export function verifySiteAccess(
  secret: string,
  token: string,
  subject: SiteAccessSubject,
  now: Date = new Date(),
): boolean {
  const [raw, sig, extra] = token.split('.');
  if (!raw || !sig || extra !== undefined || !/^\d{1,12}$/.test(raw)) return false;
  const expires = Number(raw);
  if (expires * 1000 <= now.getTime()) return false;
  return sameSignature(signature(secret, subject, expires), sig);
}
