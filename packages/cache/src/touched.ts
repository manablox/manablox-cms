import { createHash } from 'node:crypto';

/** What a request read, for cache tagging; tracked by hand as list reads bypass DataLoaders. */
export interface TouchedIds {
  content: Set<string>;
  types: Set<string>;
  assets: Set<string>;
  /** An asset list was read, so any asset write in the space could change the answer. */
  assetLists: boolean;
  /** A new document could change the answer, e.g. an unfiltered list or a permalink miss. */
  spaceWide: boolean;
  /** Further tags the answer is filed under, e.g. a space's redirects. */
  tags: Set<string>;
}

export function createTouchedIds(): TouchedIds {
  return {
    content: new Set(),
    types: new Set(),
    assets: new Set(),
    assetLists: false,
    spaceWide: false,
    tags: new Set(),
  };
}

/** Files each row under its own id and its type. */
export function trackTouched(
  touched: TouchedIds | undefined,
  rows: Iterable<{ id: string; typeId: string }>,
): void {
  if (!touched) return;
  for (const row of rows) {
    touched.content.add(row.id);
    touched.types.add(row.typeId);
  }
}

/** Files a serialised asset under its own id. */
export function trackAsset(touched: TouchedIds | undefined, id: string): void {
  touched?.assets.add(id);
}

/** Files the answer under `tag` as well. */
export function trackTag(touched: TouchedIds | undefined, tag: string): void {
  touched?.tags.add(tag);
}

/** Files an asset list under the space's asset lists. */
export function trackAssetList(touched: TouchedIds | undefined): void {
  if (touched) touched.assetLists = true;
}

/** The tag every cached asset list of the space carries. */
const assetListTag = (spaceId: string): string => `asset-list:${spaceId}`;

/** A list filtered by type is filed under those types; unfiltered, under the space. */
export function trackListTypes(
  touched: TouchedIds | undefined,
  typeIds: readonly string[] | undefined,
): void {
  if (!touched) return;
  if (typeIds?.length) for (const id of typeIds) touched.types.add(id);
  else touched.spaceWide = true;
}

/** The tags content and asset writes purge; the space tag only when needed, or when nothing else was read. */
export function touchedTags(
  touched: TouchedIds | undefined,
  spaceId: string | null,
  /** A staging environment's space tag, added wherever the space's is. */
  environmentTag: string | null = null,
): string[] {
  const tags = new Set<string>();
  const addSpace = () => {
    if (!spaceId) return;
    tags.add(`space:${spaceId}`);
    if (environmentTag) tags.add(environmentTag);
  };

  if (!touched) {
    addSpace();
    return [...tags];
  }

  for (const id of touched.content) tags.add(`content:${id}`);
  for (const id of touched.types) tags.add(`type:${id}`);
  for (const id of touched.assets) tags.add(`asset:${id}`);
  if (touched.assetLists && spaceId) tags.add(assetListTag(spaceId));
  for (const tag of touched.tags) tags.add(tag);
  if (touched.spaceWide || tags.size === 0) addSpace();

  return [...tags];
}

/** Digest and error flag a delivery surface reports for its response. */
export interface ResponseMeta {
  /** Content digest the ETag is built from. */
  digest?: string;
  /** Set when the payload carries errors, so it is never cached. */
  hasErrors?: boolean;
  /** Set when the answer came from the response cache. */
  cached?: boolean;
}

/**
 * Collision-resistant digest of cache key parts: truncated SHA-256 (128 bits), each part
 * length-prefixed so part boundaries cannot shift. For keys built from request input.
 */
export function keyDigest(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part.length}:${part}`);
  return hash.digest('base64url').slice(0, 22);
}

/** Truncated SHA-1 plus length: cheap, stable, and unique enough for a weak ETag. */
export function responseDigest(payload: string): string {
  return `${createHash('sha1').update(payload).digest('base64url').slice(0, 16)}-${payload.length.toString(16)}`;
}
