import { ManabloxError, type ResolvedScope, scopeSpaceId, targetsSpace } from '@manablox/core';
import {
  starterBundle as builtInBundle,
  starterThemes as builtInThemes,
  defaultTheme,
  designPreset,
  designPresetBundle,
  type ThemeBundle,
  type ThemeCategory,
  type ThemeDesign,
} from '@manablox/site';
import { assertBundle, codeBundle } from './code.js';
import type { ThemeContext } from './context.js';
import type { ThemeImportOptions } from './plan.js';

/** Options of `applyStarter`. */
export interface StarterOptions extends Omit<ThemeImportOptions, 'skip'> {
  /** A design preset whose layout, menus and block and page designs come along. */
  preset?: string | undefined;
}

/** A theme of the starter gallery: built in, or declared in code with `defineTheme`. */
export interface StarterThemeSummary {
  /** `builtin:<id>` or `code:<id>`. */
  id: string;
  source: 'builtin' | 'code';
  /** The plugin or `config` that declared a code theme. */
  sourceRef: string | null;
  name: string;
  description: string;
  /** Gallery group of a built-in theme; code themes have none. */
  category: ThemeCategory | null;
  /** For the gallery preview. */
  theme: ThemeDesign;
  designs: number;
  hasSite: boolean;
}

/** The starter gallery of a space: built-in themes, then code themes targeting it. */
export async function starterThemes(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
): Promise<StarterThemeSummary[]> {
  const spaceId = scopeSpaceId(scope);
  const space = await ctx.repos.spaces.findById(spaceId);
  if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
  const builtIn: StarterThemeSummary[] = builtInThemes().map((starter) => ({
    id: `builtin:${starter.id}`,
    source: 'builtin',
    sourceRef: null,
    name: starter.name,
    description: starter.description,
    category: starter.category,
    theme: starter.theme,
    designs: Object.keys(starter.menus).length,
    hasSite: false,
  }));
  const code: StarterThemeSummary[] = (await ctx.codeThemes(spaceId))
    .filter(({ entry }) => targetsSpace(entry.spaces, space.machineName))
    .map(({ plugin, entry: definition }) => ({
      id: `code:${definition.slug}`,
      source: 'code',
      sourceRef: plugin,
      name: definition.name,
      description: definition.description,
      category: null,
      theme: (definition.theme as ThemeDesign | null) ?? defaultTheme(),
      designs: definition.designs.length,
      hasSite: definition.site !== null,
    }));
  return [...builtIn, ...code];
}

/** A starter theme's bundle by gallery id; not found when the space has no such theme. */
export async function starterBundle(
  ctx: ThemeContext,
  id: string,
  space: { id: string; machineName: string },
): Promise<ThemeBundle> {
  const [source, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (source === 'builtin') {
    const starter = builtInThemes().find((entry) => entry.id === name);
    if (starter) return builtInBundle(starter);
  }
  if (source === 'code') {
    const definition = (await ctx.codeThemes(space.id)).find(
      ({ entry }) => entry.slug === name,
    )?.entry;
    if (definition && targetsSpace(definition.spaces, space.machineName)) {
      return assertBundle(codeBundle(definition));
    }
  }
  throw ManabloxError.notFound('plugins.website.theme.notFound', { id });
}

/** The starter's theme with a preset's designs; the preset's menus replace the theme's. */
export function withPreset(
  ctx: ThemeContext,
  bundle: ThemeBundle,
  presetId: string,
  scope: string | ResolvedScope,
  locale: string,
): ThemeBundle {
  const types = ctx.manablox.contentTypes
    .forSpace(scope)
    .filter((type) => !type.isSystem && type.kind !== 'data')
    .map((type) => ({
      name: type.name,
      kind: type.kind,
      fields: type.fields.map((field) => ({
        name: field.name,
        type: field.type,
        settings: field.settings,
      })),
    }));
  const preset = designPreset(presetId) ? designPresetBundle(presetId, { types, locale }) : null;
  if (!preset)
    throw ManabloxError.notFound('plugins.website.theme.preset.notFound', { id: presetId });
  const taken = new Set(preset.designs.map((design) => `${design.kind}:${design.key}`));
  return {
    ...bundle,
    designs: [
      ...bundle.designs.filter((design) => !taken.has(`${design.kind}:${design.key}`)),
      ...preset.designs,
    ],
  };
}
