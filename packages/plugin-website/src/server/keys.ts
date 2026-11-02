import { controlKeys } from '@manablox/core';
import { WEBSITE } from '../shared/site.js';
import { websiteControls } from './controls.js';

/**
 * The control keys the plugin checks, from its declaration: `websiteKeys.feature` (designed
 * sites at all), `features.*`, `usage.formSubmissions`, `rateLimits.*`, `retention.*`,
 * `settings.*`.
 */
export const websiteKeys = controlKeys(WEBSITE, websiteControls);
