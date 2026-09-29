import { type PluginRpcKit, schemas } from '@manablox/api-rpc/plugin';
import { defineConfig, definePlugin } from '@manablox/core';

/** A plugin with error keys and a router, as the reference pages list them. */
const glossaryPlugin = () =>
  definePlugin({
    name: 'glossary',
    errors: {
      'plugins.glossary.term.taken': { kind: 'conflict', message: 'That term exists already.' },
    },
    rpc: ({ scoped }: PluginRpcKit) => ({
      /** One term of the space's glossary. */
      term: scoped('glossary:read')
        .input(schemas.spaceItem)
        .handler(async () => ({ term: null })),
    }),
  });

/** An instance that is loaded, never booted: the database and secret go unused. */
export default defineConfig({
  database: { url: 'postgres://unused' },
  auth: { secret: 'unused' },
  plugins: [glossaryPlugin()],
});
