import { join } from 'node:path';
import { type PluginRouterOf, type PluginRpcKit, schemas } from '@manablox/api-rpc/plugin';
import { definePlugin, extensionPoint, type ManabloxPlugin } from '@manablox/core';
import { defineDataProvider } from '@manablox/services';
import { type HelloExtraStampRow, helloExtraRepos, helloExtraTables } from './db.js';
import { type Greeter, type HelloExtraServices, helloExtraServices } from './services.js';

declare module '@manablox/services' {
  interface TransferIdKinds {
    'hello-extra.stamps': true;
  }
}

/** The plugin's one extension point: words for the greeting board. */
const greeters = extensionPoint<Greeter>({
  description: 'Words the greeting board greets with.',
  check(entry, contributor) {
    if (!/^\p{L}+$/u.test(entry.word)) {
      throw new Error(`${contributor}: a greeter is one word, got "${entry.word}"`);
    }
  },
});

/** `plugins.hello-extra.board.get` of the management API. */
const helloExtraRpc = ({ scoped }: PluginRpcKit<HelloExtraServices>) => ({
  board: {
    get: scoped('space:read')
      .input(schemas.spaceScoped)
      .handler(async ({ input, context }) => {
        // The contributions and the other plugin, as the kit's context hands them.
        const entries = await context.plugin.contributions<Greeter>('greeters', input.spaceId);
        const hello = context.plugins.get('hello');
        return {
          words: entries.map(({ plugin, entry }) => `${entry.word} (${plugin})`),
          greetings: hello ? (await hello.greetings.list(input.spaceId)).length : null,
          helloOn: await context.plugins.isOn('hello', input.spaceId),
        };
      }),
  },
});

/** The router's type, for a typed client: `PluginRouterClient<HelloExtraRouter>`. */
export type HelloExtraRouter = PluginRouterOf<typeof helloExtraRpc>;

/** A stamp in a space export. */
interface ExportedStamp {
  id: string;
  greetingId: string | null;
  label: string;
  createdAt: string;
}

/**
 * Stamps travel in space exports, after hello's greetings they point at: the import finds each
 * greeting under the id it was restored with, and leaves out stamps whose greeting stayed behind.
 */
const helloExtraData = defineDataProvider<HelloExtraStampRow, ExportedStamp>({
  kind: 'hello-extra.stamps',
  transfer: {
    section: { label: 'Stamps', dependsOn: ['hello.greetings'] },
    count: async ({ repos, spaceId }) => (await helloExtraRepos(repos).stamps.list(spaceId)).length,
    export: async ({ repos, scope }) =>
      (await helloExtraRepos(repos).stamps.list(scope)).map((row) => ({
        id: row.id,
        greetingId: row.greetingId,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
      })),
    ids: (entries) => entries.map((entry) => entry.id),
    async import({ repos, spaceId, ids, notes }, entries) {
      const environment = await repos.environments.findByMachineName(spaceId, 'production');
      if (!environment) return;
      const greetings = ids.of('hello.greetings');
      const kept = entries.filter((entry) => !entry.greetingId || greetings.has(entry.greetingId));
      if (kept.length < entries.length) {
        notes.push(`${entries.length - kept.length} stamps were left out: their greeting was not.`);
      }
      await helloExtraRepos(repos).stamps.insert(
        kept.map((entry) => ({
          id: entry.id,
          spaceId,
          environmentId: environment.id,
          greetingId: entry.greetingId ? (greetings.get(entry.greetingId) ?? null) : null,
          label: entry.label,
          createdAt: new Date(entry.createdAt),
        })),
      );
    },
  },
});

/**
 * A plugin on top of hello, for the dependency tests: it requires hello, declares the
 * `greeters` point hello contributes to, runs a board channel from `start` to `stop`, and
 * exports stamps that point at hello's greetings.
 */
export function helloExtraPlugin(): ManabloxPlugin<HelloExtraServices> {
  return definePlugin({
    name: 'hello-extra',
    description: 'A greeting board on top of hello.',
    requires: ['hello'],
    extensionPoints: { greeters },
    // Its own words go through the same point.
    contributions: { 'hello-extra': { greeters: [{ word: 'Hi' }] } },
    db: {
      tables: helloExtraTables,
      migrations: {
        postgres: join(import.meta.dirname, 'migrations'),
        sqlite: join(import.meta.dirname, 'migrations-sqlite'),
      },
    },
    services: helloExtraServices,
    start: (plugin) => plugin.services.board.listen(plugin),
    stop: (plugin) => plugin.services.board.close(),
    rpc: helloExtraRpc,
    data: [helloExtraData],
  });
}
