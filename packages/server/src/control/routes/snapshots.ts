import type { SnapshotManifest } from '@manablox/services';
import { z } from 'zod';
import { base } from '../base.js';
import { snapshotSchema, snapshotSpace } from '../schemas.js';

export const snapshotRoutes = {
  list: base
    .route({
      method: 'GET',
      path: '/snapshots',
      summary: "A space's snapshots, newest first",
      tags: ['snapshots'],
    })
    .input(snapshotSpace)
    .output(z.object({ items: z.array(snapshotSchema) }))
    .handler(async ({ input, context }) => ({
      items: (await context.api.listSnapshots(input.spaceId)).map(snapshotView),
    })),

  create: base
    .route({
      method: 'POST',
      path: '/snapshots',
      summary: 'Take a snapshot of a space now',
      tags: ['snapshots'],
      successStatus: 201,
    })
    .input(snapshotSpace)
    .output(snapshotSchema)
    .handler(async ({ input, context }) =>
      snapshotView(await context.api.createSnapshot(input.spaceId)),
    ),

  restore: base
    .route({
      method: 'POST',
      path: '/snapshots/restore',
      summary: 'Restore a snapshot as a new space or in place of its space',
      tags: ['snapshots'],
    })
    .input(
      snapshotSpace.extend({
        snapshot: z.string().min(1).max(40).describe('A snapshot `id`.'),
        mode: z
          .enum(['new', 'replace'])
          .describe('`new` imports it as another space; `replace` puts it in place of the space.'),
      }),
    )
    .output(
      z.object({
        mode: z.enum(['new', 'replace']),
        snapshot: z.string(),
        sourceSpaceId: z.string(),
        spaceId: z.string().describe('The restored space; a new id in both modes.'),
        machineName: z.string(),
        replacedDeleted: z
          .boolean()
          .describe('`replace` only: whether the replaced space was deleted.'),
      }),
    )
    .handler(async ({ input, context }) => {
      const { import: _import, ...result } = await context.api.restoreSnapshot(
        input.spaceId,
        input.snapshot,
        input.mode,
      );
      return result;
    }),
};

/** The manifest without its format marker. */
function snapshotView(manifest: SnapshotManifest) {
  const { manabloxSnapshot: _marker, ...view } = manifest;
  return view;
}
