import { pickRpcRuntime, type RpcRequestScope } from '@manablox/api-rpc';
import { createLoaders } from '@manablox/services';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RPCHandler } from '@orpc/server/fetch';
import type { Context, Hono } from 'hono';
import type { ManagementRuntime } from '../bootstrap.js';
import { restErrorBody, transportErrors } from '../errors.js';
import { principal, principalOf } from '../middleware/principal.js';
import { served } from '../middleware/served.js';
import { mountLlmsGuide } from './llms.js';
import { openApiDocument } from './openapi.js';
import { managementRouter } from './plugin-rpc.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** Filled by the `/api/v1` procedure that ran. */
    rpcScope?: RpcRequestScope;
  }
}

/**
 * The management API: oRPC under `/rpc`, and the same procedures as REST under `/api/v1`;
 * plugin routers under `plugins.<id>`.
 */
export function mountRpc(app: Hono, runtime: ManagementRuntime): void {
  // Unexpected errors are logged and answered as `internal.error` on both transports.
  const interceptor = transportErrors(runtime.manablox.logger);
  const router = managementRouter(runtime.manablox.config.plugins);
  const rpcHandler = new RPCHandler(router, { clientInterceptors: [interceptor] });
  const openApiHandler = new OpenAPIHandler(router, {
    clientInterceptors: [interceptor],
    customErrorResponseBodyEncoder: restErrorBody,
  });

  const buildContext = (c: Context) => ({
    ...pickRpcRuntime(runtime),
    loaders: createLoaders(runtime.repos),
    principal: principalOf(c),
    headers: c.req.raw.headers,
  });

  // The resolved principal is the audit actor for everything the procedure writes.
  app.all('/rpc/*', principal(runtime), async (c) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/rpc',
      context: buildContext(c),
    });
    return matched ? response : c.notFound();
  });

  // API-key reads count as served requests.
  const servedReads = served(runtime.manablox, {
    surface: (c) => (principalOf(c)?.viaApiKey && c.get('rpcScope')?.read ? 'management' : null),
    spaceId: (c) => c.get('rpcScope')?.spaceId ?? null,
  });

  app.all('/api/v1/*', principal(runtime), servedReads, async (c) => {
    const scope: RpcRequestScope = { spaceId: null, read: false };
    c.set('rpcScope', scope);
    const { matched, response } = await openApiHandler.handle(c.req.raw, {
      prefix: '/api/v1',
      context: { ...buildContext(c), scope },
    });
    return matched ? response : c.notFound();
  });

  app.get(
    '/openapi.json',
    openApiDocument(router, {
      info: { title: 'Manablox Management API', version: '1.0.0' },
      servers: [{ url: `${runtime.manablox.config.server.publicUrl}/api/v1` }],
    }),
  );

  // The API described for language models.
  mountLlmsGuide(app, runtime);
}
