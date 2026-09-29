import type { PluginServicesContext, Scope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {} from '@manablox/plugin-workflows';
import type { WorkflowTriggerCatalogWorkflow } from '@manablox/plugin-workflows/define';
import type {} from '@manablox/server';
// The `webhook` trigger kinds of the workflow unions.
import type {} from '../../define.js';
import type { IncomingWebhookListener } from './webhook/types.js';
import { WebhookService } from './webhook.service.js';

declare module '@manablox/core' {
  /** Other plugins reach the endpoint service with `plugins.get('webhooks')`. */
  interface PluginServicesMap {
    webhooks: WebhooksServices;
  }
}

/** The plugin's services; others reach them with `plugins.get('webhooks')`. */
export interface WebhooksServices {
  webhooks: WebhookService;
}

/** Enabled workflows per incoming endpoint, counting each workflow once; none without them. */
export async function listenerCounts(
  manablox: Manablox,
  scope: Scope,
): Promise<Map<string, number>> {
  const workflows = manablox.plugins.get('workflows');
  return countListeners(workflows ? await workflows.workflows.summaries(scope) : []);
}

/** Workflows per incoming endpoint among `summaries`, counting each workflow once. */
export function countListeners(
  summaries: readonly Pick<WorkflowTriggerCatalogWorkflow, 'trigger' | 'abortTriggers'>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const workflow of summaries) {
    const ids = new Set<string>();
    if (workflow.trigger.kind === 'webhook' && workflow.trigger.webhookId) {
      ids.add(workflow.trigger.webhookId);
    }
    for (const trigger of workflow.abortTriggers) {
      if (trigger.kind === 'webhook' && trigger.webhookId) ids.add(trigger.webhookId);
    }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Hands incoming calls to the workflows plugin, when it is configured and on in the space:
 * workflows waiting on the endpoint are aborted, then started.
 */
export function workflowListener(manablox: Manablox): IncomingWebhookListener {
  return {
    async received(webhook, payload, headers) {
      const workflows = manablox.plugins.get('workflows');
      if (!workflows || !(await manablox.plugins.isOn('workflows', webhook.spaceId))) {
        return { runIds: [], abortedRunIds: [] };
      }
      return workflows.engine.runTrigger('webhook', {
        source: {
          id: webhook.id,
          spaceId: webhook.spaceId,
          environmentId: webhook.environmentId,
        },
        event: 'webhook',
        label: webhook.slug,
        context: {
          webhook: { id: webhook.id, name: webhook.name, slug: webhook.slug },
          payload,
          headers,
        },
      });
    },
    counts: (scope) => listenerCounts(manablox, scope),
  };
}

/**
 * Builds the endpoint service once per process. Deliveries go through the plugin's job queue;
 * incoming calls start and stop workflows where that plugin is configured.
 */
export function webhookServices(context: PluginServicesContext): WebhooksServices {
  const { manablox, plugin } = context;
  const { core } = plugin;
  return {
    webhooks: new WebhookService(manablox, context.repos, {
      enqueue: (deliveries) =>
        plugin.jobs.enqueueMany(
          deliveries.map((delivery) => ({ name: 'deliver', payload: { ...delivery } })),
        ),
      credentials: core.credentials ?? undefined,
      listener: workflowListener(manablox),
    }),
  };
}
