/**
 * Code-declared site themes, entries of the website plugin's `themes` extension point. A theme
 * is never written on its own: it shows up in the starter gallery of the targeted spaces and
 * becomes that space's drafts when an editor applies it.
 */

import { humanise, isMachineName, ManabloxError, type SpaceTarget } from '@manablox/core';

const THEME_DESIGN_KINDS = ['block', 'page', 'layout', 'menu'] as const;
type ThemeDesignKind = (typeof THEME_DESIGN_KINDS)[number];

/** One design a theme ships; validated with `@manablox/site` at boot. */
export interface ThemeDesignInput {
  kind: ThemeDesignKind;
  /** Block and page: the content type's machine name or id. Layout and menu: the design key. */
  key: string;
  name?: string | undefined;
  /** A `BlockDesign`, `PageDesign`, `LayoutDesign` or `MenuDesign`. */
  data: object;
}

export interface ThemeDefinitionInput {
  /** Machine name, unique across the config and plugins. */
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  spaces?: SpaceTarget | undefined;
  /** A `ThemeDesign`. */
  theme?: object | null | undefined;
  designs?: ThemeDesignInput[] | undefined;
  /** A `SiteSettingsDesign`. */
  site?: object | null | undefined;
}

export interface ThemeDefinition {
  /** The theme's `id`. */
  slug: string;
  name: string;
  description: string;
  spaces: SpaceTarget;
  theme: object | null;
  designs: ThemeDesignInput[];
  site: object | null;
}

export function defineTheme(input: ThemeDefinitionInput): ThemeDefinition {
  if (!isMachineName(input.id)) {
    throw ManabloxError.badRequest('codeResource.slug.invalid', {
      kind: 'theme',
      slug: input.id,
    });
  }
  for (const design of input.designs ?? []) {
    if (!(THEME_DESIGN_KINDS as readonly string[]).includes(design.kind) || !design.key) {
      throw ManabloxError.badRequest('plugins.website.theme.code.invalid', {
        id: input.id,
        issues: `designs: ${String(design.kind)} ${String(design.key)} is not a block, page, layout or menu design`,
      });
    }
  }
  return {
    slug: input.id,
    name: input.name ?? humanise(input.id),
    description: input.description ?? '',
    spaces: input.spaces ?? '*',
    theme: input.theme ?? null,
    designs: input.designs ?? [],
    site: input.site ?? null,
  };
}

declare module '@manablox/core' {
  /** The website plugin's extension points. */
  interface PluginContributions {
    website: {
      /** Themes for the starter gallery, made with `defineTheme`. */
      themes: ThemeDefinition;
    };
  }
}
