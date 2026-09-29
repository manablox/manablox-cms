import { ManabloxError } from '@manablox/core';
import type { SnapshotService } from '@manablox/services';
import { z } from 'zod';
import { scoped } from '../base.js';
import type { RpcContext } from '../context.js';
import { spaceScoped } from '../schemas.js';

const snapshotId = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);

function service(context: RpcContext): SnapshotService {
  if (!context.snapshots) throw ManabloxError.badRequest('snapshot.unsupported');
  return context.snapshots;
}

/** Space snapshots for the Backups page. The rules are in `SnapshotService`. */
export const snapshotRouter = {
  /** The space's snapshots, newest first, with the interval and window that apply. */
  list: scoped('space:export')
    .input(spaceScoped)
    .handler(async ({ input, context }) => {
      const snapshots = service(context);
      const resolved = await context.manablox.controls.resolved(input.spaceId);
      return {
        supported: snapshots.supported,
        interval: resolved.settings.snapshotsInterval,
        retentionDays: resolved.retention.snapshotsDays,
        items: snapshots.supported ? await snapshots.list(input.spaceId) : [],
      };
    }),

  /** Takes a snapshot now. */
  create: scoped('space:export')
    .input(spaceScoped)
    .handler(async ({ input, context }) =>
      service(context).create(input.spaceId, {
        trigger: 'manual',
        actorId: context.principal.userId,
      }),
    ),

  /**
   * Restores a snapshot as a new space or in place of this one. Owners only; `confirm` must
   * be the space's machine name.
   */
  restore: scoped('space:delete')
    .input(
      spaceScoped.extend({
        snapshot: snapshotId,
        mode: z.enum(['new', 'replace']),
        confirm: z.string().min(1).max(200),
      }),
    )
    .handler(async ({ input, context }) => {
      const { principal } = context;
      if (principal.role !== 'superadmin' && principal.spaces[input.spaceId] !== 'owner') {
        throw ManabloxError.forbidden('snapshot.ownerOnly');
      }
      const space = await context.spaces.get(input.spaceId);
      if (!space) throw ManabloxError.notFound('space.notFound', { spaceId: input.spaceId });
      if (input.confirm !== space.machineName) {
        throw ManabloxError.badRequest('snapshot.confirmMismatch');
      }
      return service(context).restore(input.spaceId, input.snapshot, {
        mode: input.mode,
        actorId: principal.userId,
      });
    }),
};
