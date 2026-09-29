// Two small plugins for the admin e2e's `plugins` project: the prebuilt admin loads their
// bundles at runtime (built from `apps/admin/e2e/fixtures/runtime-plugins`). `hello` keeps
// greetings per space, fills a step of the space wizard, a settings section and a slot of
// `hello-extra`; `hello-extra` requires it, declares an extension point both contribute to,
// declares that slot and exposes an admin api.
import { fileURLToPath } from 'node:url';
import { type PluginRouterOf, type PluginRpcKit, schemas } from '@manablox/api-rpc/plugin';
import { definePlugin, extensionPoint, type ManabloxPlugin } from '@manablox/core';
import { z } from 'zod';

interface Greeter {
  word: string;
}

declare module '@manablox/core' {
  interface PluginContributions {
    'hello-extra': { greeters: Greeter };
  }
}

/** The bundle a fixture's admin build writes. */
const bundle = (name: string) =>
  fileURLToPath(
    new URL(`../../../admin/e2e/fixtures/runtime-plugins/${name}/dist`, import.meta.url),
  );

interface HelloServices {
  greetings: Map<string, string[]>;
}

const list = (services: HelloServices, spaceId: string) => services.greetings.get(spaceId) ?? [];

const helloRpc = ({ scoped }: PluginRpcKit<HelloServices>) => ({
  greetings: {
    list: scoped('space:read')
      .input(schemas.spaceScoped)
      .handler(({ input, context }) => list(context.plugin.services, input.spaceId)),
  },
});

/** `plugins.hello` of the management API, for the fixture's admin bundle. */
export type HelloRouter = PluginRouterOf<typeof helloRpc>;

const helloExtraRpc = ({ scoped }: PluginRpcKit) => ({
  board: {
    get: scoped('space:read')
      .input(schemas.spaceScoped)
      .handler(async ({ input, context }) => {
        const greeters = await context.plugin.contributions<Greeter>('greeters', input.spaceId);
        return { words: greeters.map(({ plugin, entry }) => `${entry.word} (${plugin})`) };
      }),
  },
});

/** `plugins.hello-extra` of the management API. */
export type HelloExtraRouter = PluginRouterOf<typeof helloExtraRpc>;

export function helloPlugin(): ManabloxPlugin<HelloServices> {
  return definePlugin<HelloServices>({
    name: 'hello',
    enhances: ['hello-extra'],
    contributions: { 'hello-extra': { greeters: [{ word: 'Hello' }] } },
    services: () => ({ greetings: new Map() }),
    spaceCreate: {
      schema: z.object({ greeting: z.string().trim().max(280).default('') }),
      apply: async ({ plugin, space }, { greeting }) => {
        if (greeting) plugin.services.greetings.set(space.id, [greeting]);
      },
    },
    rpc: helloRpc,
    admin: { dir: bundle('hello') },
  });
}

export function helloExtraPlugin(): ManabloxPlugin {
  return definePlugin({
    name: 'hello-extra',
    requires: ['hello'],
    extensionPoints: { greeters: extensionPoint<Greeter>() },
    contributions: { 'hello-extra': { greeters: [{ word: 'Hi' }] } },
    rpc: helloExtraRpc,
    admin: { dir: bundle('hello-extra') },
  });
}
