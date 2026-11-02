import { clone } from '../util.js';
import type { StarterTheme } from './base.js';
import { boldTheme } from './bold.js';
import { noirTheme, playfulTheme, studioTheme } from './creative.js';
import { editorialTheme } from './editorial.js';
import { neutralTheme } from './neutral.js';
import { blossomTheme, journalTheme, terminalTheme } from './personal.js';
import { corporateTheme, minimalTheme, practiceTheme } from './professional.js';

export {
  headingDefaults,
  type StarterTheme,
  THEME_CATEGORIES,
  type ThemeCategory,
  typeScale,
} from './base.js';
export { BUNDLED_FONTS, bundledFont } from './fonts.js';

/** The built-in starter themes by category, each with its `main` and `footer` menu designs. Copies. */
export function starterThemes(): StarterTheme[] {
  return [
    neutralTheme,
    corporateTheme,
    minimalTheme,
    practiceTheme,
    boldTheme,
    studioTheme,
    playfulTheme,
    noirTheme,
    editorialTheme,
    journalTheme,
    blossomTheme,
    terminalTheme,
  ].map((entry) => clone(entry));
}
