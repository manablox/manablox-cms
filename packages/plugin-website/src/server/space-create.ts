import {
  ManabloxError,
  type PluginContext,
  type PluginCreatedSpace,
  type PluginSpaceCreate,
} from '@manablox/core';
import { defaultDesignPreset, designPreset, starterThemes } from '@manablox/site';
import { z } from 'zod';
import { websiteKeys } from './keys.js';
import type { WebsiteServices } from './services/index.js';
import type { ThemeDefinition } from './theme-define.js';

const BUILTIN = 'builtin:';

/**
 * A designed site for the new space: a starter theme (`builtin:<id>` or `code:<slug>`, the
 * first built-in one by default) and a design preset (the theme category's by default; `null`
 * or `''` keeps only the theme).
 */
const websiteSpaceSchema = z.object({
  theme: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (id) =>
        !id.startsWith(BUILTIN) || starterThemes().some((entry) => `${BUILTIN}${entry.id}` === id),
      { message: 'Unknown built-in theme.' },
    )
    .optional(),
  preset: z
    .string()
    .max(100)
    .refine((id) => id === '' || designPreset(id) !== undefined, {
      message: 'Unknown design preset.',
    })
    .nullable()
    .optional(),
});

type WebsiteSpaceData = z.infer<typeof websiteSpaceSchema>;

/** The theme and preset the data picks, defaults filled in; `null` for no preset. */
function websiteChoice(data: WebsiteSpaceData): { theme: string; preset: string | null } {
  const starters = starterThemes();
  const theme = data.theme ?? `${BUILTIN}${starters[0]?.id ?? 'neutral'}`;
  if (data.preset !== undefined) return { theme, preset: data.preset || null };
  const category = starters.find((entry) => `${BUILTIN}${entry.id}` === theme)?.category;
  return { theme, preset: defaultDesignPreset(category).id };
}

/**
 * Refuses the create while the instance allows no designed site or no designing, or the code
 * theme is unknown.
 */
async function check(plugin: PluginContext<WebsiteServices>, data: WebsiteSpaceData) {
  await plugin.controls.assertFeature(null, websiteKeys.feature);
  await plugin.controls.assertFeature(null, websiteKeys.features.design);
  const { theme } = websiteChoice(data);
  if (theme.startsWith(BUILTIN)) return;
  const slugs = plugin.contributions<ThemeDefinition>('themes').map(({ entry }) => entry.slug);
  if (!slugs.some((slug) => `code:${slug}` === theme)) {
    throw ManabloxError.validation(
      [
        {
          key: 'space.plugin.invalid',
          path: ['plugins', plugin.id, 'theme'],
          params: { plugin: plugin.id, message: `Unknown theme ${theme}.` },
        },
      ],
      'space.validation.failed',
    );
  }
}

/** Why a domain could not be claimed, in words. */
function domainProblem(error: unknown): string {
  if (!(error instanceof ManabloxError)) return error instanceof Error ? error.message : 'failed';
  const keys = [error.key, ...error.details.map((detail) => detail.key)];
  if (keys.includes('plugins.website.domain.hostname.taken')) return 'another space uses it';
  if (keys.includes('plugins.website.domain.hostname.invalid'))
    return 'it is not a valid host name';
  if (error.kind === 'forbidden') return 'custom domains are not available';
  return error.key;
}

/**
 * Sets up the designed site once the space and its types exist: the starter theme and preset
 * as drafts, the designed mode, everything published, and the host of the space URL as its
 * primary domain. Resolves to a warning when the host cannot be claimed.
 */
async function setUpDesignedSite(
  plugin: PluginContext<WebsiteServices>,
  space: PluginCreatedSpace,
  data: WebsiteSpaceData,
  actorId: string | null,
): Promise<string | null> {
  const { themes, settings, designs, domains } = plugin.services;
  const { theme, preset } = websiteChoice(data);
  await themes.applyStarter(
    space.id,
    theme,
    { replace: true, allowCode: true, ...(preset ? { preset } : {}) },
    actorId,
  );
  await settings.set(space.id, { mode: 'designed' });
  // Nothing is live on a new site, so its first design goes out at once.
  await designs.publishAll(space.id, actorId);
  if (!space.url) return 'The site has no address yet. Add a domain under Settings, API hosts.';
  const hostname = new URL(space.url).hostname;
  try {
    await domains.create(space.id, {
      hostname,
      isPrimary: true,
    });
    return null;
  } catch (error) {
    return `The site could not use ${hostname}: ${domainProblem(error)}. Add a domain under Settings, API hosts.`;
  }
}

/** The website plugin's part of a new space: a designed site when its data is sent. */
export const websiteSpaceCreate: PluginSpaceCreate<WebsiteServices, WebsiteSpaceData> = {
  schema: websiteSpaceSchema,
  apply: ({ plugin }, data) => check(plugin, data),
  afterCommit: ({ plugin, space, actorId }, data) =>
    setUpDesignedSite(plugin, space, data, actorId),
};
