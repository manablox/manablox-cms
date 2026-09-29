import { Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';

export function healthRoutes(runtime: Runtime): Hono {
  const app = new Hono();

  /** Liveness; touches no dependency. */
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  /** Readiness. */
  app.get('/readyz', async (c) => {
    try {
      await runtime.handle.ping();
      return c.json({
        status: 'ready',
        contentTypes: runtime.manablox.contentTypes.all.length,
        schemaVersion: runtime.manablox.contentTypes.schemaVersion,
      });
    } catch (error) {
      runtime.manablox.logger.error({ err: error }, 'readiness check failed');
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  return app;
}
