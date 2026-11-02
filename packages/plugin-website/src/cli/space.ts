import type { CliValues } from '@manablox/core';
import {
  defaultTheme,
  designFor,
  oneOf,
  SPACE_WEBSITES,
  text,
  validDesign,
  validTheme,
} from './catalog.js';

/** The data `spaces.create` takes as `plugins.website`. */
interface WebsiteSpaceData {
  theme: string;
  preset: string | null;
}

const BUILTIN = 'builtin:';

/** A designed site's data from `--website`, `--theme` and `--design`; `undefined` for none. */
export function websiteSpaceData(values: CliValues): WebsiteSpaceData | undefined {
  const website = oneOf('website', text(values.website) ?? 'external', SPACE_WEBSITES);
  const theme = validTheme('theme', text(values.theme) ?? defaultTheme());
  const given = text(values.design);
  const preset = given === undefined ? designFor(theme) : validDesign('design', given);
  return website === 'designed' ? { theme: `${BUILTIN}${theme}`, preset } : undefined;
}
