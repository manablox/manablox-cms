import type { Contribution } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { designAuditor } from '../../audit.js';
import type { ThemeDefinition } from '../../theme-define.js';

/** What the parts of `SiteThemeService` share. */
export interface ThemeContext {
  manablox: Manablox;
  repos: Repositories;
  audit: ReturnType<typeof designAuditor>;
  /** The code themes on in a space, each with the id of the plugin that brings it. */
  codeThemes: (spaceId: string) => Promise<readonly Contribution<ThemeDefinition>[]>;
}

/** Theme and site designs are stored under this key. */
export const DEFAULT_KEY = 'default';
