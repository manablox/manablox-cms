/** MIME allowlists: entries are exact types (`image/png`) or families (`image/`). */

/** True when `mimeType` matches an allowlist entry. */
export function mimeTypeAllowed(mimeType: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.some((entry) =>
    entry.endsWith('/') ? mimeType.startsWith(entry) : mimeType === entry,
  );
}

/** True when everything `entry` admits, the instance admits too. */
export function withinInstance(entry: string, instance: readonly string[]): boolean {
  if (instance.length === 0) return true;
  // A family must be listed whole; an exact type may be covered by its family.
  return entry.endsWith('/')
    ? instance.includes(entry)
    : instance.some((allowed) =>
        allowed.endsWith('/') ? entry.startsWith(allowed) : entry === allowed,
      );
}

/** The types both lists admit; `null` admits any type, `[]` none. */
export function intersectMimeTypes(
  a: readonly string[] | null,
  b: readonly string[] | null,
): string[] | null {
  if (a === null) return b === null ? null : [...b];
  if (b === null) return [...a];
  if (a.length === 0 || b.length === 0) return [];
  return [
    ...new Set([
      ...a.filter((entry) => withinInstance(entry, b)),
      ...b.filter((entry) => withinInstance(entry, a)),
    ]),
  ];
}
