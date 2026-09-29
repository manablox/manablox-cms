import { definePlugin } from '@manablox/core';
import { pluginMode } from '../../src/surfaces/mode.js';

/** A plugin mode serving spaces by their API host, standing in for a site process. */
export const hostedPlugin = definePlugin({
  name: 'hosted',
  modes: [
    pluginMode({
      name: 'hosted',
      scopes: ['media'],
      surface: ({ runtime }) => ({
        mount(app) {
          app.get('/', (c) => c.text('page'));
        },
        spaceOf: async (c) =>
          (await runtime.apiHosts.resolve(new URL(c.req.url).host))?.spaceId ?? null,
        served: 'hosted',
        fallback: (c, status) => c.text(`hosted ${status}`, status),
      }),
    }),
  ],
});
