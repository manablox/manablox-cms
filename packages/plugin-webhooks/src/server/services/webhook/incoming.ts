import { ManabloxError, type Scope, scopeSpaceId } from '@manablox/core';
import type { WebhookMethod, WebhookPayload } from '../../../sdk.js';
import { webhookKeys } from '../../keys.js';
import { verify } from './auth.js';
import { DELIVERIES_KEPT, loggableHeaders, type WebhookContext } from './context.js';
import type { IncomingCall, IncomingResult } from './types.js';

/** Larger incoming bodies are refused, not truncated. */
const MAX_INCOMING_BYTES = 1_048_576;

/**
 * Verifies, logs (rejections too) and hands an incoming call to the `webhooks:received` hook
 * and the listener, such as the workflows waiting on it. Throws on a bad signature, disabled
 * endpoint or disallowed method.
 */
export async function receive(
  ctx: WebhookContext,
  scope: Scope,
  slug: string,
  call: IncomingCall,
): Promise<IncomingResult> {
  const { store, manablox } = ctx;
  const spaceId = scopeSpaceId(scope);
  // Switched off: as if the endpoint did not exist.
  if (!(await manablox.controls.feature(spaceId, webhookKeys.feature)).enabled) {
    throw ManabloxError.notFound('plugins.webhooks.notFound', { slug });
  }
  const webhook = await store.findIncomingBySlug(scope, slug);
  if (!webhook) throw ManabloxError.notFound('plugins.webhooks.notFound', { slug });

  const headers = loggableHeaders(call.headers);
  const payload: WebhookPayload = {
    body: parseBody(call.raw, call.headers['content-type'] ?? ''),
    query: call.query,
    method: call.method,
  };

  const reject = async (error: ManabloxError): Promise<never> => {
    await store.createDelivery({
      webhookId: webhook.id,
      spaceId,
      direction: 'incoming',
      event: 'webhook.received',
      payload,
      headers,
      status: error.status,
      error: error.key,
    });
    await store.keepDeliveries(webhook.id, DELIVERIES_KEPT);
    throw error;
  };

  if (!webhook.enabled) await reject(ManabloxError.badRequest('plugins.webhooks.disabled'));
  if (call.raw.length > MAX_INCOMING_BYTES) {
    await reject(ManabloxError.badRequest('plugins.webhooks.payload.tooLarge'));
  }
  const methods = webhook.methods.length ? webhook.methods : ['POST'];
  if (!methods.includes(call.method.toUpperCase() as WebhookMethod)) {
    await reject(ManabloxError.badRequest('plugins.webhooks.methodNotAllowed'));
  }
  if (!(await verify(ctx, webhook, call))) {
    await reject(ManabloxError.unauthorized('plugins.webhooks.unauthorized'));
  }

  // Observers never fail the call.
  await manablox.hooks.observe(
    'webhooks:received',
    {
      webhook: {
        id: webhook.id,
        spaceId: webhook.spaceId,
        environmentId: webhook.environmentId,
        name: webhook.name,
        slug: webhook.slug,
      },
      payload,
      headers,
    },
    { manablox, spaceId, environmentId: webhook.environmentId },
  );
  // The listener aborts first, so a call that both aborts and starts replaces the old runs.
  const { runIds, abortedRunIds } = (await ctx.listener?.received(webhook, payload, headers)) ?? {
    runIds: [],
    abortedRunIds: [],
  };
  const delivery = await store.createDelivery({
    webhookId: webhook.id,
    spaceId,
    direction: 'incoming',
    event: 'webhook.received',
    payload,
    headers,
    status: 202,
    error: null,
    runIds,
  });
  await store.touch(webhook.id, ctx.now());
  await store.keepDeliveries(webhook.id, DELIVERIES_KEPT);
  await ctx.receipts.record('webhooks.webhook.received', webhook, undefined, {
    deliveryId: delivery.id,
    runs: runIds.length,
    aborted: abortedRunIds.length,
    method: call.method,
  });

  return {
    webhook: { id: webhook.id, name: webhook.name, slug: webhook.slug },
    deliveryId: delivery.id,
    runIds,
    abortedRunIds,
  };
}

/** Parses the body for templates, whatever the content type. */
function parseBody(raw: string, contentType: string): unknown {
  if (!raw) return {};
  if (contentType.includes('json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  if (contentType.includes('x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  // Try JSON anyway; many services omit the header.
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
