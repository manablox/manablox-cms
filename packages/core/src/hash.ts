/**
 * 32-bit FNV-1a as hex, for internal digests and ETags. Not collision-resistant: cache keys
 * built from request input use `keyDigest` from `@manablox/cache`.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
