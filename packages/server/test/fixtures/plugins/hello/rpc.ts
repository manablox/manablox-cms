import { type PluginRouterOf, type PluginRpcKit, schemas } from '@manablox/api-rpc/plugin';
import { z } from 'zod';
import type { HelloServices } from './services.js';

/** `plugins.hello.greetings.list`, `.create` and `.count` of the management API. */
export const helloRpc = ({ scoped }: PluginRpcKit<HelloServices>) => ({
  greetings: {
    list: scoped('space:read')
      .input(schemas.spaceScoped)
      .handler(({ context }) => context.plugin.services.greetings.list(context.env)),
    create: scoped('hello:write')
      .input(schemas.spaceScoped.extend({ message: z.string().trim().min(1).max(280) }))
      .handler(({ input, context }) =>
        context.plugin.services.greetings.create(context.env, input.message),
      ),
    /** How many there are; also while hello is locked, for a lock that names them. */
    count: scoped('space:read', { locked: true })
      .input(schemas.spaceScoped)
      .handler(
        async ({ context }) => (await context.plugin.services.greetings.list(context.env)).length,
      ),
  },
});

/** The router's type, for a typed client: `PluginRouterClient<HelloRouter>`. */
export type HelloRouter = PluginRouterOf<typeof helloRpc>;
