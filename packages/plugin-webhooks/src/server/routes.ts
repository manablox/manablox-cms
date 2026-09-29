import { isUuid, ManabloxError, type PluginServer } from '@manablox/core';
import type { PluginHelpers } from '@manablox/server';
import type { Context } from 'hono';
import { webhookKeys } from './keys.js';
import type { WebhooksServices } from './services/index.js';

/** Where incoming calls arrive under the plugin's prefix. */
const INCOMING = '/plugins/webhooks/in';

/** The path of an incoming endpoint; a staging one names its environment. */
export function incomingPath(spaceId: string, environment: string | null, slug: string): string {
  return environment
    ? `${INCOMING}/${spaceId}/${environment}/${slug}`
    : `${INCOMING}/${spaceId}/${slug}`;
}

/**
 * Incoming webhooks, authenticated by `WebhookService.receive` rather than a session. The raw
 * body is passed through because signatures cover the exact bytes.
 */
async function receive(
  c: Context,
  helpers: PluginHelpers<WebhooksServices>,
  environment: string | null,
): Promise<Response> {
  const { manablox } = helpers;
  const { core } = helpers.plugin;
  const { webhooks } = helpers.plugin.services;
  const spaceId = c.req.param('spaceId') ?? '';
  const slug = c.req.param('slug') ?? '';

  // A space still importing takes no calls.
  if (!isUuid(spaceId) || !(await core.spaces.isReady(spaceId))) {
    throw ManabloxError.notFound('plugins.webhooks.notFound', { slug });
  }
  // An unknown environment, or one while `environments` is off, has no endpoints.
  const scope = await core.environments.forRequest(spaceId, environment).catch(() => {
    throw ManabloxError.notFound('plugins.webhooks.notFound', { slug });
  });
  await manablox.controls.assertWritable(scope);

  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  const result = await webhooks.receive(scope, slug, {
    method: c.req.method,
    raw: c.req.method === 'GET' ? '' : await c.req.text(),
    headers,
    query: c.req.query(),
  });

  // 202: what listens, such as workflows, is started, not finished.
  return c.json(
    {
      ok: true,
      delivery: result.deliveryId,
      runs: result.runIds.length,
      aborted: result.abortedRunIds.length,
    },
    202,
  );
}

/**
 * `/plugins/webhooks/in/<spaceId>/<slug>` of the management server, without a session: the
 * endpoint's own auth decides. Rate limited per IP before anything is looked up.
 */
export const webhookServer: PluginServer<WebhooksServices> = {
  routes: [
    {
      scopes: ['management'],
      register(app, helpers) {
        const limit = helpers.rateLimit(webhookKeys.rateLimits.incoming);
        // `<spaceId>/<slug>` is production's endpoint; another environment's names it in between.
        app.all('/in/:spaceId/:slug', limit, (c) => receive(c, helpers, null));
        app.all('/in/:spaceId/:environment/:slug', limit, (c) =>
          receive(c, helpers, c.req.param('environment') ?? null),
        );
      },
    },
  ],
};
