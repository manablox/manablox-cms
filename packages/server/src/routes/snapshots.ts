import { Readable } from 'node:stream';
import { assertCan } from '@manablox/auth';
import { isSnapshotId } from '@manablox/services';
import { Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { principal, principalOf, requireSuperadmin } from '../middleware/principal.js';

/** A snapshot's export as a plain JSON download, importable like any export. Superadmin only. */
export function snapshotRoutes(runtime: Runtime): Hono {
  const app = new Hono();

  app.get(
    '/transfer/snapshots/:spaceId/:snapshot',
    principal(runtime),
    requireSuperadmin,
    async (c) => {
      const spaceId = c.req.param('spaceId');
      const id = c.req.param('snapshot');
      if (!isSnapshotId(id)) return c.notFound();
      // A key narrowed to other spaces is refused.
      assertCan(principalOf(c), spaceId, 'space:export');
      const { manifest, stream } = await runtime.snapshots.open(spaceId, id);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${manifest.machineName}-${id}.manablox.json"`,
        },
      });
    },
  );

  return app;
}
