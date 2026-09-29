/** Naming helpers shared by the registry, the GraphQL schema and the admin. */

/** `page_component` -> `Page component` */
export function humanise(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** GraphQL object type name for a content type: `page_component` -> `PageComponent`. */
export function graphqlTypeName(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** `A` -> `A (copy)` -> `A (copy 2)`, skipping names in `taken`. */
export function copyName(name: string, taken: readonly string[] = []): string {
  const match = /^(.*) \(copy(?: (\d+))?\)$/.exec(name);
  const base = match?.[1] ?? name;
  const start = match ? Number(match[2] ?? 1) + 1 : 1;
  for (let n = start; n < start + 100; n += 1) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}
