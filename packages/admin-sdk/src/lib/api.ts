import type { ManabloxRouter } from '@manablox/api-rpc';
import type { PluginRouter, PluginRouterClient } from '@manablox/api-rpc/plugin';
import { CLIENT_ID_HEADER } from '@manablox/core';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { clientId } from './client-id';
import { environmentHeaders } from './environment';

/** The typed management client, typed from `ManabloxRouter` without codegen. */
const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  // The client id lets the live feed skip this tab's own writes.
  headers: (_options, _path, input) => ({
    [CLIENT_ID_HEADER]: clientId,
    ...environmentHeaders(input),
  }),
  // The session is an httpOnly cookie.
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
});

const client: RouterClient<ManabloxRouter> = createORPCClient(link);

/** What `api` answers with instead of the link; set by `@manablox/admin-sdk/testing`. */
let replacement: object | null = null;

/** Routes `api` (and every `pluginClient`) to `next`, or back to the link with `null`. */
export function replaceApiClient(next: object | null): void {
  replacement = next;
}

/** Each property is read when used, so a client held from module load follows a replacement. */
function lazy<T extends object>(target: () => object): T {
  return new Proxy({} as T, { get: (_object, key) => Reflect.get(target(), key) });
}

export const api: RouterClient<ManabloxRouter> = lazy(() => replacement ?? client);

/** The typed client of plugin `id`'s router (`plugins.<id>`), over the admin's link. */
export function pluginClient<R extends PluginRouter>(id: string): PluginRouterClient<R> {
  return lazy(() => (api as unknown as { plugins: Record<string, object> }).plugins[id] as object);
}

export { errorDetails, errorKey } from './api-errors';
