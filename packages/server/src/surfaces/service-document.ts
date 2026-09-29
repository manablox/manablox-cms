import type { Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import type { SurfaceMode } from './mode.js';
import { publicSpaceOf } from './public-host.js';

/** The public instance's root document, listing its surfaces and the request's space. */
export function mountServiceDocument(app: Hono, runtime: Runtime, mode: SurfaceMode): void {
  const { config } = runtime.manablox;
  app.get('/', (c) =>
    c.json({
      name: 'Manablox Public API',
      version: '1.0.0',
      space: publicSpaceOf(c),
      surfaces: {
        ...(mode.scopes.has('graphql') ? { graphql: config.graphql.path } : {}),
        ...(mode.scopes.has('delivery') ? { rest: '/v1', openapi: '/openapi.json' } : {}),
        ...(mode.scopes.has('media') ? { media: '/media/{assetId}/{variant}' } : {}),
      },
    }),
  );
}
