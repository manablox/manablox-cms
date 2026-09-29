/** `hero.banner` -> `HeroBanner`; a leading digit gets a `T`, an empty name becomes `Type`. */
export function pascalName(name: string, prefix = ''): string {
  const joined =
    prefix +
    name
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  if (!joined) return 'Type';
  return /^[0-9]/.test(joined) ? `T${joined}` : joined;
}

/** Whether `name` can be a bare JavaScript identifier or property key. */
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}
