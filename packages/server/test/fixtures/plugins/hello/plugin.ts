import { join } from 'node:path';
import {
  auditor,
  defineJob,
  definePlugin,
  type ManabloxPlugin,
  type PluginContext,
  type PluginServer,
  type PluginServerMode,
  type PluginSpaceCreate,
  pluginError,
} from '@manablox/core';
import { z } from 'zod';
import { helloData, helloGreetingKind } from './data.js';
import { type HelloGreetingRow, helloRepos, helloTables } from './db.js';
import { helloRpc } from './rpc.js';
import {
  type HelloServices,
  helloControls,
  helloKeys,
  helloServices,
  shouted,
} from './services.js';

/** `GET /plugins/hello/greetings` of the management server: the space's greetings. */
const helloServer: PluginServer<HelloServices> = {
  routes: [
    {
      scopes: ['management'],
      register(app, helpers) {
        app.get('/greetings', async (c) => {
          const spaceId = await helpers.requireSpace(c);
          await helpers.requirePermission(c, 'space:read', spaceId);
          return c.json(await helpers.plugin.services.greetings.list(spaceId));
        });
      },
    },
  ],
};

/** `server.mode: 'hello'`: one anonymous route, `GET /`. */
const helloMode: PluginServerMode<HelloServices> = {
  name: 'hello',
  scopes: [],
  surface: ({ plugin }) => ({
    mount(app) {
      app.get('/', (c) => c.text(`Hello from the ${plugin.id} mode`));
    },
  }),
};

const draft = z.object({ greeting: z.string().trim().max(280).default('') });

/** A new space's first greeting, from the space create. */
const helloSpaceCreate: PluginSpaceCreate<HelloServices, z.infer<typeof draft>> = {
  schema: draft,
  async apply({ plugin, repos, space }, { greeting }) {
    if (!greeting) return;
    if (
      shouted(greeting) &&
      !(await plugin.controls.feature(null, helloKeys.features.shout)).enabled
    ) {
      throw pluginError('plugins.hello.shoutingOff');
    }
    const row = await helloRepos(repos).greetings.create({ spaceId: space.id }, greeting);
    await auditor(repos, 'hello.greeting', (entry: HelloGreetingRow) => entry.message).record(
      'hello.greeting.create',
      row,
    );
  },
};

export interface HelloPluginOptions {
  /** Content types that get a `greeting` field, declared in the config or by another plugin. */
  greetOn?: readonly string[];
}

/**
 * A plugin on most extension points at once, for the platform tests: its own table, a router,
 * a route, a mode, jobs, a create step, controls, a data provider, and contributions to
 * `hello-extra`, which it enhances.
 */
export function helloPlugin(options: HelloPluginOptions = {}): ManabloxPlugin<HelloServices> {
  return definePlugin({
    name: 'hello',
    description: 'Greetings per space.',
    enhances: ['hello-extra'],
    contributions: {
      'hello-extra': { greeters: [{ word: 'Hello' }, { word: 'Servus' }] },
    },
    resourceKinds: { 'hello.greeting': helloGreetingKind },
    extend: (options.greetOn ?? []).map((name) => ({
      name,
      fields: [
        {
          name: 'greeting',
          type: 'string',
          settings: { max: 280 },
          admin: { zone: 'sidebar', help: 'A greeting shown with the entry' },
        },
      ],
    })),
    db: {
      tables: helloTables,
      migrations: {
        postgres: join(import.meta.dirname, 'migrations'),
        sqlite: join(import.meta.dirname, 'migrations-sqlite'),
      },
    },
    permissions: [
      {
        key: 'hello:write',
        label: 'Add greetings',
        description: 'Create greetings in the space.',
        roles: ['editor'],
      },
    ],
    controls: helloControls,
    audit: { entities: ['hello.greeting'] },
    errors: {
      'plugins.hello.shoutingOff': {
        kind: 'forbidden',
        message: 'Greetings in capitals are switched off in this space.',
      },
    },
    jobs: {
      greet: defineJob(
        z.object({ spaceId: z.string(), message: z.string() }),
        async ({ spaceId, message }, plugin: PluginContext<HelloServices>) => {
          await plugin.services.greetings.create(spaceId, message);
        },
      ),
    },
    maintenance: [
      {
        name: 'tally',
        every: 60 * 60_000,
        run: async (plugin) => {
          const total = await helloRepos(plugin.repos).greetings.countForSpaces('all');
          plugin.logger.info({ total }, 'greetings counted');
        },
      },
    ],
    services: helloServices,
    spaceCreate: helloSpaceCreate,
    rpc: helloRpc,
    server: helloServer,
    modes: [helloMode],
    data: [helloData],
  });
}
