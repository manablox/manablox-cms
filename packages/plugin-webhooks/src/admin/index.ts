import { defineAdminPlugin, enabledSwitchOutcome } from '@manablox/admin-plugin';
import type {} from '@manablox/plugin-workflows/admin-slots';
import { invalidateWebhooks } from './keys';
import './style.css';
import { WEBHOOK_HINTS, type WebhookTriggerValue, webhookOf } from './model/trigger';

/** Endpoints have no page of their own; the list holds them. */
const WEBHOOK_ENTITY = { label: 'Webhook', route: () => '/webhooks' };

/** The endpoint actions, by verb. */
const ACTIONS: Record<string, [label: string, verb: string]> = {
  'webhooks.webhook.create': ['Added a webhook', 'Created'],
  'webhooks.webhook.update': ['Edited a webhook', 'Edited'],
  'webhooks.webhook.setEnabled': ['Switched a webhook on or off', 'Switched'],
  'webhooks.webhook.delete': ['Removed a webhook', 'Deleted'],
  'webhooks.webhook.test': ['Sent a test call to a webhook', 'Tested'],
  'webhooks.webhook.received': ['An incoming webhook was called', 'Called'],
};
const actions = Object.fromEntries(Object.entries(ACTIONS).map(([name, [label]]) => [name, label]));
const verbs = Object.fromEntries(Object.entries(ACTIONS).map(([name, [, verb]]) => [name, verb]));

/**
 * Webhooks: the list of incoming and outgoing endpoints with their call logs, and what they add
 * to workflows, the `webhook` trigger and abort trigger.
 */
export default defineAdminPlugin({
  name: 'webhooks',
  slots: {
    'workflows:triggerForm': [
      {
        key: 'webhook',
        kind: 'webhook',
        icon: 'webhook',
        tone: 'iris',
        component: () => import('./slots/WebhookTriggerForm.vue'),
        create: (preset, catalog) => ({
          kind: 'webhook',
          webhookId: preset ?? webhookOf(catalog, null)[0]?.id ?? null,
          filter: null,
        }),
        abort: (preset, catalog) => ({
          kind: 'webhook',
          webhookId: preset ?? webhookOf(catalog, null)[0]?.id ?? null,
        }),
        ready: (trigger) => Boolean((trigger as WebhookTriggerValue).webhookId),
        title: (trigger, catalog) => {
          const hook = webhookOf(catalog, (trigger as WebhookTriggerValue).webhookId)[0];
          return hook ? `${hook.name} is called` : 'A webhook is called';
        },
        hints: WEBHOOK_HINTS,
        filter: {
          title: 'Only for some calls',
          hint: 'One endpoint can feed a workflow per event a service sends: match on what arrived, and the rest of the calls pass this workflow by.',
          lead: 'Run this workflow only if',
          field: 'payload.body.',
        },
        abortFilter: {
          hint: 'Abort only for calls that match, e.g. a certain action in the body.',
          field: 'payload.body.',
          key: '{{ payload.body.orderId }}',
        },
        sample: () => import('./slots/WebhookSampleDialog.vue'),
        runLabel: 'Webhook call',
        startedBy: (context) => {
          const hook = context.webhook as { name?: string } | undefined;
          return hook?.name ? `to ${hook.name}` : null;
        },
        startPart: (context) => (context.webhook ? { label: 'Payload', path: 'payload' } : null),
        abortedBy: (abort) => `by a call to ${abort.event ?? 'a webhook'}`,
        imported: invalidateWebhooks,
      },
    ],
  },
  routes: [
    {
      path: 'webhooks',
      name: 'webhooks',
      component: () => import('./pages/WebhookList.vue'),
      section: '/webhooks',
    },
  ],
  menu: [
    {
      label: 'Webhooks',
      icon: 'webhook',
      to: '/webhooks',
      group: 'automation',
      order: 200,
      permission: 'webhooks:read',
      shortcut: 'h',
    },
  ],
  transferSections: [
    {
      kind: 'webhooks.webhooks',
      group: 'integrations',
      icon: 'webhook',
      label: 'Webhooks',
      description:
        'Endpoints and their events; secrets stay behind. Past deliveries are not carried over.',
      noun: ['webhook', 'webhooks'],
      pickable: true,
    },
  ],
  realtime: {
    'webhooks.webhook': (event) => invalidateWebhooks(event.spaceId),
  },
  audit: {
    entities: {
      'webhooks.webhook': WEBHOOK_ENTITY,
    },
    actions,
    verbs,
    outcomes: {
      'webhooks.webhook.setEnabled': enabledSwitchOutcome,
    },
  },
  features: { 'plugins.webhooks': 'Webhooks' },
  permissionIcons: { 'plugins.webhooks': 'webhook' },
  diffKinds: { webhooks: 'Webhooks' },
  // A promote replaces production's endpoints.
  invalidateOnPromote: invalidateWebhooks,
});
