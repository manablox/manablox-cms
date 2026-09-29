/** Redirect vocabulary shared by the database, services and the APIs. Browser-safe. */

export const REDIRECT_STATUSES = [301, 302] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

/** `auto`: made by a permalink change on publish; `manual`: made by an editor. */
export const REDIRECT_SOURCES = ['auto', 'manual'] as const;
export type RedirectSource = (typeof REDIRECT_SOURCES)[number];

/** The tag every cached read of a space's redirects carries. */
export const redirectsCacheTag = (spaceId: string): string => `redirects:${spaceId}`;
