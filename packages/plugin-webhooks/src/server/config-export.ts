import { humanise, parseCodeRef } from '@manablox/core';
import { type ResourceConfigExport, runtimeOnly } from '@manablox/services';
import type { WebhookDefinitionInput } from '../define.js';
import { type WebhookRow, webhookRepos } from './db/index.js';

/** An endpoint as `defineWebhook` input; the credential named by its slot, never its secret. */
function webhookInput(
  row: WebhookRow,
  slug: string,
  credentialSlug: (id: string) => string | null,
): WebhookDefinitionInput {
  const outgoing = row.direction === 'outgoing';
  const credential = row.credentialId ? credentialSlug(row.credentialId) : null;
  return {
    slug,
    direction: row.direction,
    ...(row.name === humanise(slug) ? {} : { name: row.name }),
    ...(row.description ? { description: row.description } : {}),
    ...(row.enabled ? {} : { enabled: false }),
    ...(outgoing
      ? {
          url: row.url,
          ...(row.events.length ? { events: row.events } : {}),
          ...(row.headers.length ? { headers: row.headers } : {}),
        }
      : { ...(row.methods.length ? { methods: row.methods } : {}) }),
    ...(row.authMode === 'none'
      ? {}
      : {
          auth: {
            mode: row.authMode,
            ...(credential ? { credential } : {}),
            ...(row.authMode === 'hmac'
              ? {
                  signatureHeader: row.signatureHeader,
                  algorithm: row.algorithm,
                  format: row.signatureFormat,
                }
              : {}),
          },
        }),
  };
}

/** The space's own endpoints as `defineWebhook` declarations; secrets stay behind. */
export const webhookConfigExport: ResourceConfigExport<WebhookRow> = {
  label: 'Webhooks',
  description: 'Endpoints either direction; secrets stay behind, credentials are named.',
  icon: 'webhook',
  define: { name: 'defineWebhook', from: '@manablox/plugin-webhooks/define' },
  load: async ({ repos, spaceId }) =>
    runtimeOnly(await webhookRepos(repos).listBySpace(spaceId)).map((row) => ({
      id: row.id,
      label: row.name,
      slug: row.slug,
      row,
    })),
  render: (row, { slug, deref }) => ({
    input: webhookInput(row, slug, (id) => {
      const reference = parseCodeRef(deref(id));
      return reference?.kind === 'credential' ? reference.name : null;
    }),
  }),
};
