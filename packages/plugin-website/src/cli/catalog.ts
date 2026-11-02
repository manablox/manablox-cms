import { DESIGN_PRESETS, defaultDesignPreset, starterThemes } from '@manablox/site';

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
}

/** `designed`: a theme and the site process; `external`: an own frontend on the delivery API. */
export type SpaceWebsite = 'designed' | 'external';

export const SPACE_WEBSITES: readonly SpaceWebsite[] = ['designed', 'external'];

/** The bundled starter themes. */
export function spaceThemes(): CatalogEntry[] {
  return starterThemes().map(({ id, name, description, category }) => ({
    id,
    name,
    description,
    category,
  }));
}

/** The built-in design presets. */
export function spaceDesigns(): CatalogEntry[] {
  return DESIGN_PRESETS.map(({ id, name, description, category }) => ({
    id,
    name,
    description,
    category,
  }));
}

/** The first starter theme. */
export function defaultTheme(): string {
  return spaceThemes()[0]?.id ?? 'neutral';
}

/** The preset a theme starts with: the first of its category. */
export function designFor(theme: string): string {
  const category = starterThemes().find((entry) => entry.id === theme)?.category;
  return defaultDesignPreset(category).id;
}

export function oneOf<T extends string>(option: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`--${option} must be one of ${allowed.join(', ')}, not '${value}'`);
  }
  return value as T;
}

export function validTheme(option: string, value: string): string {
  return oneOf(
    option,
    value,
    spaceThemes().map((theme) => theme.id),
  );
}

/** A preset id, or `none` for the theme alone. */
export function validDesign(option: string, value: string): string | null {
  if (value === 'none') return null;
  return oneOf(
    option,
    value,
    spaceDesigns().map((design) => design.id),
  );
}

export function validPort(option: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--${option} '${value}' is not a port`);
  }
  return port;
}

/** A value option's string, or `undefined`. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The theme ids of each category, for the help. */
export function themesHelp(): string[] {
  return byCategory(spaceThemes(), (id, index) => (index === 0 ? `${id} (default)` : id));
}

/** The design ids of each category, for the help. */
export function designsHelp(): string[] {
  return byCategory(spaceDesigns(), (id) => id);
}

function byCategory(
  entries: CatalogEntry[],
  label: (id: string, index: number) => string,
): string[] {
  const groups = new Map<string, string[]>();
  entries.forEach((entry, index) => {
    groups.set(entry.category, [...(groups.get(entry.category) ?? []), label(entry.id, index)]);
  });
  return [...groups].map(([category, ids]) => `${category}: ${ids.join(', ')}`);
}
