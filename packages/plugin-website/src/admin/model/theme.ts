import { TOKEN_NAME } from '@manablox/site';

/** A copy of `record` with `from` renamed to `to`, keeping the order. */
export function renameKey<V>(
  record: Record<string, V>,
  from: string,
  to: string,
): Record<string, V> {
  return Object.fromEntries(
    Object.entries(record).map(([name, value]) => [name === from ? to : name, value]),
  );
}

/** A copy of `record` without `name`. */
export function withoutKey<V>(record: Record<string, V>, name: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== name));
}

/** A name not in `taken`: `base`, else `base2`, `base3`, ... */
export function freeName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

/** Why a token name is refused, or `null`. */
export function tokenNameIssue(
  name: string,
  taken: Iterable<string>,
  reserved: readonly string[] = [],
): string | null {
  if (!TOKEN_NAME.test(name))
    return 'Use letters, digits and dashes, starting with a letter or digit.';
  if (reserved.includes(name)) return `"${name}" is reserved.`;
  if (new Set(taken).has(name)) return `"${name}" is used already.`;
  return null;
}
