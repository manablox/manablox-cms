import { controlKeys } from '@manablox/core';
import { aiControls } from './controls.js';

/** The plugin's id. */
export const AI = 'ai';

/**
 * The control keys the plugin checks, from its declaration: `aiKeys.feature` (AI at all),
 * `aiKeys.usage.calls` (calls per period, also the per-user rate rule), `aiKeys.features.*`.
 */
export const aiKeys = controlKeys(AI, aiControls);
