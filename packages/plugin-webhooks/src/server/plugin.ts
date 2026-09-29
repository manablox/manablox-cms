import { defineJob, definePlugin, type ManabloxPlugin, type PluginContext } from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import type {} from '@manablox/plugin-workflows/define';
import { z } from 'zod';
import { webhookAudit } from './audit.js';
import { webhookResourceKinds } from './code-resources.js';
import { webhookControls } from './controls.js';
import { webhooksData } from './data.js';
import * as tables from './db/tables.js';
import { webhookErrors } from './errors.js';
import type {} from './hooks.js';
import { WEBHOOKS } from './keys.js';
import { webhookLlms } from './llms.js';
import { webhookPermissions } from './permissions.js';
import { webhookServer } from './routes.js';
import { webhookRpc } from './rpc.js';
import { type WebhooksServices, webhookServices } from './services/index.js';
import { outgoingHooks } from './services/webhook/outgoing.js';
import { webhookTriggerKinds } from './triggers.js';

/**
 * Webhooks: outgoing endpoints called when content changes, and incoming ones other systems
 * call at `/plugins/webhooks/in/...`, which fire `webhooks:received` and start and stop the
 * workflows waiting on them. Contributes the `webhook` trigger and abort trigger to workflows.
 */
export function webhooksPlugin(): ManabloxPlugin<WebhooksServices> {
  const pkg = pluginPackage(import.meta.url);
  const kinds = webhookTriggerKinds();
  return definePlugin<WebhooksServices>({
    name: WEBHOOKS,
    description: 'Outgoing and incoming webhooks; incoming calls start and stop workflows.',
    enhances: ['workflows'],
    db: {
      tables,
      migrations: pkg.migrations,
    },
    permissions: webhookPermissions,
    controls: webhookControls,
    audit: webhookAudit,
    errors: webhookErrors,
    contributions: {
      workflows: {
        triggers: [kinds.trigger],
        abortTriggers: [kinds.abort],
        designHints: [
          {
            section: 'placeholders',
            text: '- {{ payload.body.<path> }}, {{ headers.<name> }}: an incoming webhook call; {{ webhook.name }}: the endpoint called.',
          },
        ],
      },
    },
    services: webhookServices,
    // Content changes fan out to the outgoing endpoints listening.
    hooks: outgoingHooks,
    jobs: {
      // Queued deliveries, on the worker; a failure throws so the queue's backoff retries.
      deliver: defineJob(
        z.object({
          webhookId: z.string(),
          event: z.string(),
          payload: z.record(z.string(), z.unknown()),
          attempt: z.number().int().optional(),
        }),
        async (delivery, plugin: PluginContext<WebhooksServices>) => {
          await plugin.services.webhooks.deliver(delivery);
        },
      ),
    },
    server: webhookServer,
    resourceKinds: webhookResourceKinds,
    rpc: webhookRpc,
    data: [webhooksData],
    admin: { dir: pkg.adminDir },
    llms: webhookLlms,
  });
}
