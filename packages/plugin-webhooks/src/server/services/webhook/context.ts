import { type LocalCache, localCache } from '@manablox/cache';
import {
  type CredentialSecret,
  ManabloxError,
  purgeTags,
  type Scope,
  scopeSpaceId,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { WEBHOOK_REDACTED_HEADERS } from '../../../sdk.js';
import type { receiptAuditor } from '../../audit.js';
import { type WebhookRepository, type WebhookRow, webhookRepos } from '../../db/index.js';
import type { IncomingWebhookListener, WebhookServiceOptions } from './types.js';

/** Deliveries kept per endpoint. */
export const DELIVERIES_KEPT = 200;

/** What the service's parts share. */
export interface WebhookContext {
  manablox: Manablox;
  repos: Repositories;
  /** The endpoints and their log on `repos`. */
  store: WebhookRepository;
  options: WebhookServiceOptions;
  fetch: typeof fetch;
  now: () => Date;
  receipts: ReturnType<typeof receiptAuditor>;
  /** Who acts on incoming calls besides the hook, e.g. the workflows waiting on them. */
  listener: IncomingWebhookListener | null;
  /** The enabled outgoing endpoints of an environment, see `enabledEndpoints`. */
  enabled: (scope: Scope) => Promise<WebhookRow[]>;
}

/** How long an environment's enabled outgoing endpoints are reused; writes drop them at once. */
const ENABLED_TTL_MS = 5_000;
const ENABLED_KEPT = 1_000;

/** The cache tag of a space's endpoints. */
const endpointsTag = (spaceId: string) => `plugins.webhooks:${spaceId}`;

const enabledCaches = new WeakMap<Manablox, LocalCache<WebhookRow[]>>();

/**
 * The enabled outgoing endpoints of an environment, kept in process for seconds: every save
 * dispatches through them. A committed endpoint write drops a space's entries here and, as a
 * cache purge, in every other process.
 */
export function enabledEndpoints(
  manablox: Manablox,
  repos: Repositories,
): (scope: Scope) => Promise<WebhookRow[]> {
  let cache = enabledCaches.get(manablox);
  if (!cache) {
    const kept = localCache<WebhookRow[]>(manablox, { max: ENABLED_KEPT, ttlMs: ENABLED_TTL_MS });
    cache = kept;
    enabledCaches.set(manablox, kept);
    const unsubscribe = webhookRepos(repos).onChange((spaceId) => {
      kept.purge([endpointsTag(spaceId)]);
      purgeTags(manablox, spaceId, [endpointsTag(spaceId)]).catch((error: unknown) =>
        manablox.logger.warn({ err: error, spaceId }, 'webhook endpoints purge failed'),
      );
    });
    manablox.onDispose(unsubscribe);
  }
  const kept = cache;
  return (scope) => {
    const key = typeof scope === 'string' ? scope : `${scope.spaceId}:${scope.environmentId}`;
    return kept.load(key, async () => ({
      value: await webhookRepos(repos).listEnabledBySpace(scope),
      tags: [endpointsTag(scopeSpaceId(scope))],
    }));
  };
}

export async function credentialFor(
  { options }: WebhookContext,
  webhook: WebhookRow,
): Promise<CredentialSecret> {
  if (!options.credentials || !webhook.credentialId) {
    throw ManabloxError.badRequest('plugins.webhooks.auth.credentialRequired');
  }
  return options.credentials.resolve(webhook.spaceId, webhook.credentialId);
}

/** Headers safe to log, with secret-bearing ones dropped. */
export function loggableHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (WEBHOOK_REDACTED_HEADERS.has(key)) continue;
    kept[key] = value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return kept;
}
