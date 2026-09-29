import type { PluginControls } from '@manablox/core';

/**
 * The endpoint limit, both call rates and delivery retention under `plugins.webhooks`; the
 * plugin's flag is webhooks themselves.
 */
export const webhookControls = {
  'limits.plugins.webhooks.count': {
    label: 'Webhooks',
    description: 'Webhooks, either direction.',
    nouns: ['webhook', 'webhooks'],
  },
  'rateLimits.plugins.webhooks.incoming': {
    description: 'Incoming webhook calls per IP.',
    default: { max: 600, windowSeconds: 60 },
  },
  'rateLimits.plugins.webhooks.outgoing': {
    description: 'Outgoing webhook deliveries per space.',
  },
  'retention.plugins.webhooks.deliveriesDays': {
    description: 'Webhook deliveries (the newest 200 stay the ceiling).',
  },
} satisfies PluginControls;
