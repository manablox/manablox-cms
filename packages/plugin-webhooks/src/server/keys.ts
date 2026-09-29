import { controlKeys } from '@manablox/core';
import { webhookControls } from './controls.js';

/** The plugin's id. */
export const WEBHOOKS = 'webhooks';

/**
 * The control keys the plugin checks, from its declaration: `webhookKeys.feature` (endpoints,
 * deliveries and incoming calls), `limits.count`, `rateLimits.incoming` / `outgoing`,
 * `retention.deliveriesDays`.
 */
export const webhookKeys = controlKeys(WEBHOOKS, webhookControls);
