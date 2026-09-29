/** Browser-safe id and name helpers; Node-only generators are in `./ids.node.ts`. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

/** Machine names: lowercase, alphanumeric, single hyphens/underscores, no edges. */
const MACHINE_NAME_RE = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const isMachineName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && MACHINE_NAME_RE.test(value);

const GERMAN_TRANSLITERATION: Record<string, string> = {
  Ä: 'Ae',
  ä: 'ae',
  Ö: 'Oe',
  ö: 'oe',
  Ü: 'Ue',
  ü: 'ue',
  ß: 'ss',
};

/** Transliterates, strips marks and lowercases; shared by admin inputs and `slugify`. */
export function normaliseForSlug(input: string): string {
  return (
    input
      // Before NFKD, which would turn "ü" into "u" plus a mark.
      .replace(/[ÄäÖöÜüß]/g, (c) => GERMAN_TRANSLITERATION[c] ?? c)
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  );
}

export function slugify(input: string): string {
  return normaliseForSlug(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);
}

/**
 * A technical name as the server stores it. Without `final` (while typing) trailing
 * separators and leading digits stay, so the input does not fight the cursor.
 */
export function technicalName(input: string, { final = false } = {}): string {
  let value = normaliseForSlug(input)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-');

  if (final) value = value.replace(/^[^a-z]+/, '').replace(/[-_]+$/, '');
  return value.slice(0, 64);
}

/** A URL slug via `slugify`; without `final` (while typing) a trailing hyphen is kept. */
export function slugDraft(input: string, { final = false } = {}): string {
  const value = slugify(input);
  if (final || !value) return value;
  const pending = /[^a-z0-9]$/.test(normaliseForSlug(input));
  return pending && value.length < 190 ? `${value}-` : value;
}
