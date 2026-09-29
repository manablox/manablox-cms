import { createCache, redisHub } from '@manablox/cache';
import { ManabloxError } from '@manablox/core';
import { CONTROL_ACTOR, runAsActor } from '@manablox/core/node';
import { ControlApi } from '@manablox/services';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { Hono } from 'hono';
import { type Runtime, requireManagement } from '../bootstrap.js';
import { controlAuth } from '../control/auth.js';
import { IDEMPOTENCY_TTL_SECONDS, idempotency } from '../control/idempotency.js';
import { controlOpenApiDocument } from '../control/openapi.js';
import { type ControlContext, controlRouter } from '../control/router.js';
import { restErrorBody, transportErrors } from '../errors.js';

/**
 * The control API under `/control`: `/control/v1/*` and `/control/openapi.json`, behind the
 * control key. Management instances only; every write is audited as the control API.
 */
export function mountControl(app: Hono, source: Runtime): void {
  const runtime = requireManagement(source);
  const { manablox } = runtime;
  const config = manablox.config.control;
  if (!config.apiKey) {
    throw ManabloxError.validation(
      [{ key: 'config.control.keyMissing', path: ['control', 'apiKey'] }],
      'config.invalid',
    );
  }

  const { redisUrl } = manablox.config.cache;
  const replays = createCache(
    { enabled: true, ttl: IDEMPOTENCY_TTL_SECONDS, ...(redisUrl ? { redisUrl } : {}) },
    { redis: redisHub(manablox)?.command },
  );
  manablox.onDispose(() => replays.close());

  const context: ControlContext = {
    runtime,
    api: new ControlApi({
      ...runtime,
      usageState: runtime.controlStore.usageState,
      afterSpaceCreate: async (spaceId) => {
        await runtime.codeResources.sync({ spaceIds: [spaceId] });
      },
    }),
  };
  const handler = new OpenAPIHandler(controlRouter, {
    clientInterceptors: [transportErrors(manablox.logger)],
    customErrorResponseBodyEncoder: restErrorBody,
  });

  app.use('/control/*', controlAuth(config));
  app.use('/control/v1/*', idempotency(replays, manablox.logger));

  let document: ReturnType<typeof controlOpenApiDocument> | null = null;
  app.get('/control/openapi.json', async (c) => {
    document ??= controlOpenApiDocument();
    return c.json((await document) as object);
  });

  app.all('/control/v1/*', async (c) => {
    const actor = {
      ...CONTROL_ACTOR,
      detail: { requestId: c.get('requestId') },
    };
    c.set('auditActor', actor);
    const { matched, response } = await runAsActor(actor, () =>
      handler.handle(c.req.raw, { prefix: '/control/v1', context }),
    );
    return matched ? response : c.notFound();
  });
}
