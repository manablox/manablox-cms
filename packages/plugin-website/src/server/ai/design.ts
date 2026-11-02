import type { ContentTypeDefinition } from '@manablox/core';
import { type BlockDesign, defaultTheme, type ThemeDesign } from '@manablox/site';
import {
  composeSiteBlockDesignPrompt,
  readSiteBlockDesign,
  SITE_BLOCK_DESIGN_SYSTEM,
  type SiteBlockDesign,
} from './site-block.js';
import {
  composeSiteThemeDesignPrompt,
  readSiteThemeDesign,
  SITE_THEME_DESIGN_SYSTEM,
  type SiteThemeDesign,
} from './site-theme.js';

/**
 * The part of the AI plugin's design service the website uses, from `plugins.get('ai')`. The
 * website only enhances AI, so it describes the shape itself and never needs the package. The
 * service checks the flags and refuses a design with nothing usable.
 */
export interface AiDesigner {
  design<T>(request: {
    spaceId: string;
    providerKind?: string | undefined;
    model?: string | undefined;
    prompt: string;
    system: string;
    purpose: string;
    actorId?: string | null | undefined;
    check: (answer: Record<string, unknown>) => Promise<{ value: T; problems: string[] }>;
    usable?: ((value: T) => boolean) | undefined;
  }): Promise<{ value: T; problems: string[]; generationId: string }>;
}

/** What every AI design takes. */
interface AiDesignInput {
  spaceId: string;
  providerKind?: string | undefined;
  model?: string | undefined;
  prompt: string;
  actorId?: string | null | undefined;
}

export interface AiSiteThemeInput extends AiDesignInput {
  /** A 6-digit hex color to build the palette around. */
  brandColor?: string | null | undefined;
  /** The theme the answer is built on; the default theme when absent. */
  base?: ThemeDesign | null | undefined;
}

export interface AiSiteBlockInput extends AiDesignInput {
  type: ContentTypeDefinition;
  theme: ThemeDesign;
  locales: readonly string[];
  current?: BlockDesign | null | undefined;
}

/** Theme tokens from a brand color or a description; nothing is written. */
export async function designSiteTheme(
  designer: AiDesigner,
  input: AiSiteThemeInput,
): Promise<SiteThemeDesign & { theme: ThemeDesign; problems: string[]; generationId: string }> {
  const context = { base: input.base ?? defaultTheme(), brandColor: input.brandColor };
  const result = await designer.design({
    spaceId: input.spaceId,
    providerKind: input.providerKind,
    model: input.model,
    prompt: composeSiteThemeDesignPrompt(input.prompt, context),
    system: SITE_THEME_DESIGN_SYSTEM,
    purpose: 'Site theme',
    actorId: input.actorId,
    check: (answer) => readSiteThemeDesign(answer, context),
    usable: (value) => Boolean(value.theme),
  });
  const theme = result.value.theme as ThemeDesign;
  return { ...result.value, theme, problems: result.problems, generationId: result.generationId };
}

/** A block design bound to the type's fields and styled with the theme's tokens; not written. */
export async function designSiteBlock(
  designer: AiDesigner,
  input: AiSiteBlockInput,
): Promise<SiteBlockDesign & { design: BlockDesign; problems: string[]; generationId: string }> {
  const context = {
    type: input.type,
    theme: input.theme,
    locales: input.locales,
    current: input.current,
  };
  const result = await designer.design({
    spaceId: input.spaceId,
    providerKind: input.providerKind,
    model: input.model,
    prompt: composeSiteBlockDesignPrompt(input.prompt, context),
    system: SITE_BLOCK_DESIGN_SYSTEM,
    purpose: 'Block design',
    actorId: input.actorId,
    check: (answer) => readSiteBlockDesign(answer, context),
    usable: (value) => Boolean(value.design),
  });
  const design = result.value.design as BlockDesign;
  return { ...result.value, design, problems: result.problems, generationId: result.generationId };
}
