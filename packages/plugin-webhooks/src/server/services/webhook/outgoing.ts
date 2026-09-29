import {
  CONTENT_EVENT_ALIASES,
  type ContentEvent,
  contentEventHooks,
  type PluginContext,
  type PluginHookRegistration,
  RetryLater,
  RunError,
  type Scope,
  scopeSpaceId,
} from '@manablox/core';
import { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_HEADER } from '../../../sdk.js';
import type { WebhookDeliveryRow, WebhookRow } from '../../db/index.js';
import { webhookKeys } from '../../keys.js';
import type {} from '../index.js';
import { applyAuth } from './auth.js';
import { DELIVERIES_KEPT, loggableHeaders, type WebhookContext } from './context.js';
import type { WebhookDelivery } from './types.js';

/**
 * The plugin's `hooks`: content lifecycle events fanned out to the space's outgoing webhooks,
 * after core's own handlers, by the process's webhook service where it built one.
 */
export function outgoingHooks(plugin: PluginContext): PluginHookRegistration[] {
  return contentEventHooks(
    async (event, rows, { scope }) => {
      const services = plugin.plugins.get('webhooks');
      if (!services) return;
      // Removals carry the ids only; the rows are gone or drafts.
      const removal = event === 'content.deleted' || event === 'content.unpublished';
      await services.webhooks.dispatch(
        event,
        scope,
        rows.map((row) => (removal ? { id: row.id } : summary(row))),
      );
    },
    { priority: 200 },
  );
}

/**
 * Queues a delivery per payload, per event the one satisfies, per enabled webhook of the
 * environment listening.
 */
export async function dispatch(
  ctx: WebhookContext,
  event: string,
  scope: Scope,
  payloads: readonly Record<string, unknown>[],
): Promise<void> {
  if (payloads.length === 0) return;
  const events = CONTENT_EVENT_ALIASES[event as ContentEvent] ?? [event];
  const hooks = await ctx.enabled(scope);
  if (hooks.length === 0) return;
  if (!(await ctx.manablox.controls.feature(scopeSpaceId(scope), webhookKeys.feature)).enabled) {
    return;
  }
  const deliveries: WebhookDelivery[] = [];
  for (const payload of payloads) {
    for (const name of events) {
      for (const hook of hooks) {
        if (hook.events.length > 0 && !hook.events.includes(name)) continue;
        deliveries.push({ webhookId: hook.id, event: name, payload });
      }
    }
  }
  if (deliveries.length > 0) await ctx.options.enqueue(deliveries);
}

/** Sends and logs one delivery; throws on failure so the queue's backoff retries. */
export async function deliver(ctx: WebhookContext, data: WebhookDelivery): Promise<void> {
  const webhook = await ctx.store.findById(data.webhookId);
  if (!webhook?.enabled || webhook.direction !== 'outgoing') return;
  // Queued deliveries of a switched-off space are dropped.
  if (!(await ctx.manablox.controls.feature(webhook.spaceId, webhookKeys.feature)).enabled) return;
  // Over the space's budget the delivery waits instead of being dropped.
  const decision = await ctx.manablox.controls.rate(webhook.spaceId, [
    { rule: webhookKeys.rateLimits.outgoing, key: webhook.spaceId },
  ]);
  if (decision && !decision.allowed) {
    throw new RetryLater(decision.retryAfter * 1000, webhookKeys.rateLimits.outgoing);
  }
  const row = await send(ctx, webhook, data);
  if (!row.error) return;
  const method = 'POST';
  throw row.status === null
    ? new RunError(
        'plugins.webhooks.delivery.requestFailed',
        { method, url: webhook.url, reason: row.error },
        row.error,
      )
    : new RunError(
        'plugins.webhooks.delivery.httpStatus',
        { method, url: webhook.url, status: row.status },
        row.error,
      );
}

/** Sends and always logs; never throws. */
export async function send(
  ctx: WebhookContext,
  webhook: WebhookRow,
  data: WebhookDelivery,
): Promise<WebhookDeliveryRow> {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({
    event: data.event,
    payload: data.payload,
    at: ctx.now().toISOString(),
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const header of webhook.headers) headers[header.name.toLowerCase()] = header.value;
  headers[WEBHOOK_EVENT_HEADER] = data.event;
  headers[WEBHOOK_DELIVERY_HEADER] = deliveryId;

  let failure: string | null = null;
  try {
    await applyAuth(ctx, webhook, headers, body);
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause);
  }

  let status: number | null = null;
  const started = Date.now();
  if (!failure) {
    try {
      const response = await ctx.fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      if (!response.ok) failure = `HTTP ${response.status}`;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const row = await ctx.store.createDelivery({
    webhookId: webhook.id,
    spaceId: webhook.spaceId,
    direction: 'outgoing',
    event: data.event,
    payload: data.payload,
    headers: loggableHeaders(headers),
    status,
    error: failure,
    attempt: data.attempt ?? 1,
    ms: Date.now() - started,
  });
  await ctx.store.touch(webhook.id, ctx.now());
  await ctx.store.keepDeliveries(webhook.id, DELIVERIES_KEPT);

  if (failure) {
    ctx.manablox.logger.warn(
      { webhookId: webhook.id, spaceId: webhook.spaceId, status, err: failure },
      'webhook delivery failed',
    );
  }
  return row;
}

/** Minimal document summary for outgoing events. */
const summary = (row: { id: string; permalink?: string | null }): Record<string, unknown> => ({
  id: row.id,
  ...(row.permalink === undefined ? {} : { permalink: row.permalink }),
});
