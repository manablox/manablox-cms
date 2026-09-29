import { DAY_MS, type SignatureAlgorithm, type SignatureFormat } from '@manablox/core';
import { defineDataProvider, rowsSection, runtimeOnly } from '@manablox/services';
import type { WebhookAuthMode, WebhookDirection, WebhookMethod } from '../sdk.js';
import { webhookAuditor } from './audit.js';
import { type WebhookRow, webhookRepos } from './db/index.js';
import { webhookKeys } from './keys.js';

/** An endpoint in a space export's `webhooks.webhooks` section. */
export interface ExportedWebhook {
  id: string;
  direction: WebhookDirection;
  name: string;
  slug: string;
  description: string | null;
  url: string;
  events: string[];
  headers: Array<{ name: string; value: string }>;
  methods: WebhookMethod[];
  /** Auth mode and vault entry; an endpoint needing a secret arrives disabled. */
  authMode: WebhookAuthMode;
  credentialId?: string | null;
  signatureHeader: string;
  algorithm: SignatureAlgorithm;
  signatureFormat: SignatureFormat;
  enabled: boolean;
}

export const toExportedWebhook = (row: WebhookRow): ExportedWebhook => ({
  id: row.id,
  direction: row.direction,
  name: row.name,
  slug: row.slug,
  description: row.description,
  url: row.url,
  events: row.events,
  headers: row.headers,
  methods: row.methods,
  authMode: row.authMode,
  credentialId: row.credentialId,
  signatureHeader: row.signatureHeader,
  algorithm: row.algorithm,
  signatureFormat: row.signatureFormat,
  enabled: row.enabled,
});

/** Audit meta of rows a space import writes, as core's imports record them. */
const IMPORTED = { via: 'space.import' };

/**
 * The space's endpoints and their calls: environment copies, which arrive switched off, the
 * transfer section, switching endpoints back on
 * when a snapshot restore brings their credential's secret along, delivery retention, the
 * endpoint count. Endpoints stay per environment: a promote
 * matches staging's to production's by direction and slug, so what points at them follows,
 * and writes none.
 */
export const webhooksData = defineDataProvider<WebhookRow, ExportedWebhook>({
  kind: 'webhooks.webhooks',
  environments: {
    key: 'webhooks',
    load: ({ repos, environmentId }) => webhookRepos(repos).listByEnvironment(environmentId),
    match: (row) => (row.slug ? `${row.direction}\n${row.slug}` : null),
    async copy({ repos, rows }) {
      await webhookRepos(repos).insertRows(
        rows.map((row) => ({ ...row, enabled: false, lastUsedAt: null })),
      );
    },
    // No `promote`: production's endpoints stay as they are.
  },
  transfer: {
    section: { label: 'Webhooks', dependsOn: ['credentials'] },
    ...rowsSection({
      list: async ({ repos }, scope) => runtimeOnly(await webhookRepos(repos).listBySpace(scope)),
      count: ({ repos }, spaceId) => webhookRepos(repos).countRuntimeBySpace(spaceId),
      label: (row) => row.name,
      toExported: toExportedWebhook,
    }),
    limits: (entries) => ({ [webhookKeys.limits.count]: entries.length }),
    // Before anything is written, so a refusal leaves nothing behind.
    async check({ manablox, spaceId }, entries) {
      if (!manablox.hooks.has('webhooks:beforeCreate')) return;
      for (const entry of entries) {
        await manablox.hooks.run(
          'webhooks:beforeCreate',
          { spaceId, direction: entry.direction, name: entry.name },
          { manablox, spaceId },
        );
      }
    },
    // After credentials, which endpoints reference by foreign key.
    async import({ repos, spaceId, ids }, entries) {
      const store = webhookRepos(repos);
      const audit = webhookAuditor(repos);
      const restored = ids.of('credentials');
      for (const entry of entries) {
        // Secrets do not travel, so an authenticating endpoint arrives disabled.
        const needsCredential = entry.authMode !== undefined && entry.authMode !== 'none';
        const credentialId = entry.credentialId ?? null;
        const row = await store.create({
          ...entry,
          spaceId,
          credentialId: credentialId && restored.has(credentialId) ? credentialId : null,
          enabled: needsCredential ? false : entry.enabled,
        });
        await audit.record('webhooks.webhook.create', row, undefined, IMPORTED);
      }
    },
  },
  snapshot: {
    // An endpoint that was on comes back on once its credential's secret did.
    async afterCredentialsRestored({ repos, ids, entries }, sealed) {
      const store = webhookRepos(repos);
      for (const entry of entries) {
        const target = ids.get(entry.id);
        const credentialId = entry.credentialId ?? null;
        if (!target || !entry.enabled || !credentialId || !sealed.has(credentialId)) continue;
        await store.update(target, { enabled: true });
      }
    },
  },
  retention: [
    {
      key: webhookKeys.retention.deliveriesDays,
      prune: ({ repos, spaceId, limit }, days) =>
        webhookRepos(repos).pruneDeliveries({
          spaceId,
          before: new Date(Date.now() - days * DAY_MS),
          limit,
        }),
    },
  ],
  counters: {
    [webhookKeys.limits.count]: ({ repos }, spaceIds) =>
      webhookRepos(repos).countProduction(spaceIds),
  },
});
