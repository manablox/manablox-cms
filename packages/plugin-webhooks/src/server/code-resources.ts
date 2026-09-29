/**
 * The `webhooks.webhook` code resource kind: endpoints either direction, reconciled by
 * `CodeResourceService` through the plugin resource kind contract; declarations are
 * `resources.plugins['webhooks.webhook']`.
 */

import { resolveCodeRefs } from '@manablox/core';
import { stableId } from '@manablox/core/node';
import type { SpaceRow } from '@manablox/db';
import {
  byEnvironment,
  defineResourceKind,
  type ResourcePassContext,
  reasonOf,
  reconcileResources,
  type SyncChange,
  sameShape,
  syncEntry,
} from '@manablox/services';
import { WEBHOOK_RESOURCE_KIND, type WebhookDefinition } from '../define.js';
import { codeWebhookAuditor, WEBHOOK_ENTITY } from './audit.js';
import { webhookConfigExport } from './config-export.js';
import { type WebhookRow, type WebhookWriteData, webhookRepos } from './db/index.js';
import type { WebhookPlan } from './triggers.js';

export const codeWebhookId = (spaceId: string, direction: string, slug: string): string =>
  stableId('webhook', `${spaceId}:${direction}:${slug}`);

/** Endpoints, either direction; an endpoint with an empty credential arrives off. */
const webhookKind = defineResourceKind<
  WebhookDefinition,
  WebhookRow[],
  WebhookPlan & { resolve(name: string): string | undefined },
  WebhookRow
>({
  // The space's own endpoints, written back as declarations by the config export.
  configExport: webhookConfigExport,

  load: ({ repos, spaces }) =>
    byEnvironment(
      webhookRepos(repos).listBySpaces(
        spaces.map((space) => space.id),
        undefined,
        'all',
      ),
    ),

  plan: ({ declared, rows, key }) => {
    const incoming = new Map<string, string>();
    for (const definition of declared) {
      if (definition.direction !== 'incoming') continue;
      incoming.set(definition.slug, codeWebhookId(key, 'incoming', definition.slug));
    }
    for (const row of rows) {
      if (row.direction === 'incoming') incoming.set(row.slug, row.id);
    }
    return { incoming, resolve: (name) => incoming.get(name) };
  },

  reconcile: ({ manablox, repos, space, environment, key, declared, rows, options, plan }) =>
    reconcileResources<
      WebhookDefinition,
      WebhookRow,
      Omit<WebhookWriteData, 'id' | 'spaceId' | 'environmentId'>
    >(space, declared, options, {
      kind: WEBHOOK_RESOURCE_KIND,
      slug: (definition) => definition.slug,
      id: (definition) => codeWebhookId(key, definition.direction, definition.slug),
      key: (definition) => `${definition.direction}:${definition.slug}`,
      rowKey: (row) => `${row.direction}:${row.slug}`,
      taken: 'an endpoint of this space already has that slug',
      rows,
      audit: {
        create: 'webhooks.webhook.create',
        update: 'webhooks.webhook.update',
        auditor: codeWebhookAuditor(repos),
      },
      create: (id, fields) =>
        webhookRepos(repos).create({
          id,
          spaceId: space.id,
          environmentId: environment.id,
          ...fields,
        }),
      update: (id, fields) => webhookRepos(repos).update(id, fields),
      prepare: async (definition, current) => {
        let auth: WebhookDefinition['auth'];
        try {
          auth = resolveCodeRefs(definition.auth, plan.resolve);
        } catch (error) {
          return { skip: reasonOf(error) };
        }
        // A refused new endpoint is skipped, so one plugin cannot stop the sync or startup.
        if (!current && manablox.hooks.has('webhooks:beforeCreate')) {
          try {
            await manablox.hooks.run(
              'webhooks:beforeCreate',
              { spaceId: space.id, direction: definition.direction, name: definition.name },
              { manablox, spaceId: space.id },
            );
          } catch (error) {
            manablox.logger.warn(
              { err: error, spaceId: space.id, slug: definition.slug },
              'code webhook refused',
            );
            return { skip: `refused: ${reasonOf(error)}` };
          }
        }

        // An endpoint with an empty credential is created disabled.
        const unfilled = auth.credentialId ? !plan.byId.get(auth.credentialId)?.filled : false;

        const desired = {
          direction: definition.direction,
          name: definition.name,
          slug: definition.slug,
          description: definition.description,
          url: definition.url,
          events: definition.events,
          headers: definition.headers,
          methods: definition.methods,
          authMode: auth.mode,
          credentialId: auth.credentialId,
          signatureHeader: auth.signatureHeader,
          algorithm: auth.algorithm,
          signatureFormat: auth.format,
          source: 'code' as const,
          sourceRef: definition.sourceRef ?? null,
        };

        return {
          desired,
          // `enabled` is create-only; the operator owns it afterwards.
          onCreate: { enabled: unfilled ? false : definition.enabled },
          ...(unfilled ? { reason: 'its credential is empty, so it arrives off' } : {}),
          same: (row) =>
            row.source === 'code' &&
            row.sourceRef === desired.sourceRef &&
            sameShape(desired, row as unknown as Record<string, unknown>),
        };
      },
    }),

  prune: ({ repos, space, declared, rows, options }) =>
    pruneRows({
      space,
      options,
      rows,
      declared: new Set(
        declared.map((declaration) => `${declaration.direction}:${declaration.slug}`),
      ),
      remove: async (row) => {
        await webhookRepos(repos).delete(row.id);
        await codeWebhookAuditor(repos).record(`${WEBHOOK_ENTITY}.delete`, row);
      },
      disable: async (row) => {
        await webhookRepos(repos).update(row.id, { enabled: false });
        await codeWebhookAuditor(repos).record(`${WEBHOOK_ENTITY}.setEnabled`, row, undefined, {
          enabled: false,
        });
      },
    }),
});

/**
 * Handles code rows whose declaration is gone. Disabling is the default because rolling
 * deploys run two code versions at once and deletion drops the delivery history.
 */
async function pruneRows(spec: {
  space: SpaceRow;
  options: ResourcePassContext['options'];
  rows: WebhookRow[];
  declared: Set<string>;
  remove: (row: WebhookRow) => Promise<void>;
  disable: (row: WebhookRow) => Promise<void>;
}): Promise<SyncChange[]> {
  const { options } = spec;
  const changes: SyncChange[] = [];
  for (const row of spec.rows.filter((row) => row.source === 'code')) {
    if (spec.declared.has(`${row.direction}:${row.slug}`)) continue;
    changes.push(
      syncEntry(
        WEBHOOK_RESOURCE_KIND,
        row.slug,
        spec.space,
        options.prune ? 'deleted' : 'disabled',
      ),
    );
    if (options.dryRun) continue;
    if (options.prune) await spec.remove(row);
    else if (row.enabled) await spec.disable(row);
  }
  return changes;
}

/** The plugin's code resource kinds. */
export const webhookResourceKinds = { [WEBHOOK_RESOURCE_KIND]: webhookKind };
