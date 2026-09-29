import type { Manablox } from '@manablox/core/node';
import type { WebhookDeliveryView, WebhookView } from '../../../sdk.js';
import type { WebhookDeliveryRow, WebhookRow } from '../../db/index.js';
import { incomingPath } from '../../routes.js';

/** `environment` is the machine name of a staging endpoint's environment. */
export function webhookView(
  manablox: Manablox,
  row: WebhookRow,
  listeners: number,
  environment: string | null = null,
): WebhookView {
  return {
    id: row.id,
    spaceId: row.spaceId,
    direction: row.direction,
    name: row.name,
    slug: row.slug,
    description: row.description,
    enabled: row.enabled,
    url: row.url,
    events: row.events,
    headers: row.headers,
    methods: row.methods,
    auth: {
      mode: row.authMode,
      credentialId: row.credentialId,
      signatureHeader: row.signatureHeader,
      algorithm: row.algorithm,
      format: row.signatureFormat,
    },
    endpoint: row.direction === 'incoming' ? endpointUrl(manablox, row, environment) : null,
    listeners,
    source: row.source,
    sourceRef: row.sourceRef,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Public URL of an incoming endpoint; a staging one names its environment. */
function endpointUrl(manablox: Manablox, row: WebhookRow, environment: string | null): string {
  const base = manablox.config.server.publicUrl.replace(/\/+$/, '');
  return `${base}${incomingPath(row.spaceId, environment, row.slug)}`;
}

export function deliveryView(row: WebhookDeliveryRow): WebhookDeliveryView {
  return {
    id: row.id,
    webhookId: row.webhookId,
    direction: row.direction,
    event: row.event,
    payload: row.payload as Record<string, unknown>,
    headers: row.headers,
    status: row.status,
    error: row.error,
    attempt: row.attempt,
    ms: row.ms,
    runIds: row.runIds,
    createdAt: row.createdAt.toISOString(),
  };
}
