import { ManabloxError } from '@manablox/core';
import type { SpaceEnvironmentRow } from '@manablox/db';
import type { EnvironmentLifecycleService } from '@manablox/services';
import { z } from 'zod';
import { scoped } from '../base.js';
import type { RpcContext } from '../context.js';
import { machineName, spaceScoped, uuid } from '../schemas.js';

const mode = z.enum(['config', 'full']);
const target = z.object({ spaceId: uuid, environment: machineName });

function lifecycle(context: RpcContext): EnvironmentLifecycleService {
  if (!context.environmentLifecycle) throw ManabloxError.badRequest('environment.unsupported');
  return context.environmentLifecycle;
}

/** One environment as the admin lists it. */
export interface EnvironmentView {
  id: string;
  machineName: string;
  name: string;
  kind: 'production' | 'staging';
  /** The environment it was copied from, by id. */
  createdFrom: string | null;
  createdMode: 'config' | 'full' | null;
  createdAt: Date;
  updatedAt: Date;
}

function environmentView(row: SpaceEnvironmentRow): EnvironmentView {
  return {
    id: row.id,
    machineName: row.machineName,
    name: row.name,
    kind: row.kind,
    createdFrom: row.createdFrom,
    createdMode: row.createdMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A space's environments. The rules are in `EnvironmentLifecycleService`. */
export const environmentRouter = {
  /** Production first; every member sees them, to switch between them. */
  list: scoped('space:read')
    .input(spaceScoped)
    .handler(async ({ input, context }) =>
      (await context.environments.list(input.spaceId)).map(environmentView),
    ),

  /** Copies an environment, production by default, into a new staging one. */
  create: scoped('environment:manage')
    .input(
      z.object({
        spaceId: uuid,
        from: machineName.optional(),
        machineName,
        name: z.string().trim().min(1).max(200),
        mode: mode.default('config'),
      }),
    )
    .handler(async ({ input, context }) => {
      const { environment, copied } = await lifecycle(context).create(input.spaceId, {
        from: input.from,
        machineName: input.machineName,
        name: input.name,
        mode: input.mode,
      });
      return { environment: environmentView(environment), copied };
    }),

  /** What promoting the environment would change in production. */
  diff: scoped('environment:manage')
    .input(target.extend({ mode: mode.default('config') }))
    .handler(async ({ input, context }) =>
      lifecycle(context).diff(input.spaceId, input.environment, input.mode),
    ),

  /** Moves the environment into production; `confirm` when the diff asks for it. */
  promote: scoped('environment:manage')
    .input(target.extend({ mode: mode.default('config'), confirm: z.boolean().default(false) }))
    .handler(async ({ input, context }) =>
      lifecycle(context).promote(input.spaceId, input.environment, input.mode, {
        confirm: input.confirm,
      }),
    ),

  /** Deletes a staging environment with everything in it. */
  delete: scoped('environment:manage')
    .input(target)
    .handler(async ({ input, context }) => {
      await lifecycle(context).delete(input.spaceId, input.environment);
      return { ok: true as const };
    }),
};
