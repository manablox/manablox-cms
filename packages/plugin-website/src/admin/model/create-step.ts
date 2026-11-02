import type { FeatureState } from '@manablox/admin-sdk';
import type { FeatureKey } from '@manablox/core';
import { defaultDesignPreset, starterThemes } from '@manablox/site';

/**
 * What decides whether a new space can get a designed site: the website's flag, then
 * designing. The instance decides, as the space has no group yet.
 */
export function designedSiteFeature(feature: (key: FeatureKey) => FeatureState): {
  key: FeatureKey;
  state: FeatureState;
} {
  const site = feature('plugins.website');
  if (!site.enabled) return { key: 'plugins.website', state: site };
  return { key: 'plugins.website.design', state: feature('plugins.website.design') };
}

/** The website step's state in the space creation form. */
export interface WebsiteDraft {
  frontend: 'designed' | 'external';
  /** A starter theme, `builtin:<id>`. */
  theme?: string;
  /** A design preset id; `''` keeps only the theme. */
  preset?: string;
  /** Set once a preset is picked by hand; until then it follows the theme's category. */
  presetPicked?: boolean;
}

/** The draft with its defaults: a designed site while the instance allows one. */
export function websiteDraft(draft: Record<string, unknown>, designedSite: boolean): WebsiteDraft {
  const frontend =
    draft.frontend === 'designed' || draft.frontend === 'external'
      ? draft.frontend
      : designedSite
        ? 'designed'
        : 'external';
  const out: WebsiteDraft = { frontend };
  if (typeof draft.theme === 'string') out.theme = draft.theme;
  if (typeof draft.preset === 'string') out.preset = draft.preset;
  if (draft.presetPicked === true) out.presetPicked = true;
  return out;
}

/** The starter theme and the design preset the draft picks, defaults filled in. */
export function websiteChoice(draft: WebsiteDraft): { theme: string; preset: string } {
  const starters = starterThemes();
  const theme = draft.theme ?? (starters[0] ? `builtin:${starters[0].id}` : '');
  const category = starters.find((entry) => `builtin:${entry.id}` === theme)?.category;
  const preset = draft.presetPicked ? (draft.preset ?? '') : defaultDesignPreset(category).id;
  return { theme, preset };
}

/** What `spaces.create` gets for the website plugin: the choice for a designed site, else none. */
export function websiteData(
  draft: Record<string, unknown>,
  designedSite: boolean,
): { theme: string; preset: string } | undefined {
  const website = websiteDraft(draft, designedSite);
  return website.frontend === 'designed' ? websiteChoice(website) : undefined;
}
