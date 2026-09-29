/// <reference path="../virtual.d.ts" />
import { actions, eager, subjects } from 'virtual:manablox/icon-names';

/** Icon names without their data, from the file names in `icons/<pack>/`; `Icon.vue` loads the data. */

/** Shipped with the entry. */
export const EAGER_ICON_NAMES: readonly string[] = eager;

/** Fetched on first use, from `icons/actions`. */
export const ACTION_ICON_NAMES: readonly string[] = actions;

/** Fetched on first use, from `icons/subjects`. */
export const SUBJECT_ICON_NAMES: readonly string[] = subjects;

export const ICON_NAMES: string[] = [
  ...EAGER_ICON_NAMES,
  ...ACTION_ICON_NAMES,
  ...SUBJECT_ICON_NAMES,
].sort();

/** Content-type picker icons: subject icons plus admin icons that name a thing, not an action. */
export const TYPE_ICON_NAMES: string[] = [
  'doc',
  'folder',
  'template',
  'blocks',
  'image',
  'globe',
  'users',
  'user',
  'star',
  'mail',
  'key',
  'workflow',
  'tree',
  'list',
  'braces',
  'code',
  'search',
  'clock',
  'activity',
  'zap',
  ...SUBJECT_ICON_NAMES,
].sort();
