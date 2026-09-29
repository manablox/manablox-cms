import type { SpaceEnvironmentRow } from '@manablox/db';
import { PROMOTE_GROUPS } from '@manablox/services';
import { z } from 'zod';
import { base } from '../base.js';
import {
  environmentDiff,
  environmentMode,
  environmentParam,
  environmentSchema,
  spaceIdParam,
} from '../schemas.js';

export const environmentRoutes = {
  list: base
    .route({
      method: 'GET',
      path: '/spaces/{id}/environments',
      summary: "A space's environments, production first",
      tags: ['environments'],
    })
    .input(z.object({ id: spaceIdParam }))
    .output(z.object({ items: z.array(environmentSchema) }))
    .handler(async ({ input, context }) => ({
      items: (await context.api.listEnvironments(input.id)).map(environmentView),
    })),

  create: base
    .route({
      method: 'POST',
      path: '/spaces/{id}/environments',
      summary: 'Copy an environment into a new staging environment',
      tags: ['environments'],
      successStatus: 201,
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ id: spaceIdParam }),
        body: z.object({
          from: environmentParam
            .optional()
            .describe('The environment to copy; production by default.'),
          machineName: environmentParam,
          name: z.string().trim().min(1).max(200),
          mode: environmentMode.default('config'),
        }),
      }),
    )
    .output(
      z.object({
        environment: environmentSchema,
        copied: z
          .object({
            contentTypes: z.number(),
            contents: z.number(),
            menus: z.number(),
            menuItems: z.number(),
            redirects: z.number(),
          })
          .catchall(z.number())
          .describe("Rows copied per kind, data providers' by their key."),
      }),
    )
    .handler(async ({ input, context }) => {
      const result = await context.api.createEnvironment(input.params.id, input.body);
      return { ...result, environment: environmentView(result.environment) };
    }),

  diff: base
    .route({
      method: 'GET',
      path: '/spaces/{id}/environments/{environment}/diff',
      summary: 'What promoting an environment would change in production',
      tags: ['environments'],
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ id: spaceIdParam, environment: environmentParam }),
        query: z.object({ mode: environmentMode.default('config') }),
      }),
    )
    .output(environmentDiff)
    .handler(({ input, context }) =>
      context.api.diffEnvironment(input.params.id, input.params.environment, input.query.mode),
    ),

  promote: base
    .route({
      method: 'POST',
      path: '/spaces/{id}/environments/{environment}/promote',
      summary: 'Promote a staging environment into production',
      tags: ['environments'],
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ id: spaceIdParam, environment: environmentParam }),
        body: z.object({
          mode: environmentMode.default('config'),
          confirm: z
            .boolean()
            .default(false)
            .describe('Required when the diff says `confirmRequired`.'),
        }),
      }),
    )
    .output(
      z.object({
        environment: z.string(),
        mode: z.enum(['config', 'full']),
        status: z
          .enum(['applied', 'partial', 'failed'])
          .describe('`partial`: a group failed after earlier ones were applied.'),
        snapshot: z.string().nullable().describe('The snapshot of production taken first.'),
        groups: z.array(
          z.object({
            group: z
              .string()
              .describe(`One of ${PROMOTE_GROUPS.join(', ')}, or a data provider's key.`),
            status: z.enum(['applied', 'failed', 'skipped']),
            error: z.string().nullable(),
          }),
        ),
        diff: environmentDiff,
      }),
    )
    .handler(({ input, context }) =>
      context.api.promoteEnvironment(
        input.params.id,
        input.params.environment,
        input.body.mode,
        input.body.confirm,
      ),
    ),

  delete: base
    .route({
      method: 'DELETE',
      path: '/spaces/{id}/environments/{environment}',
      summary: 'Delete a staging environment with everything in it',
      tags: ['environments'],
    })
    .input(z.object({ id: spaceIdParam, environment: environmentParam }))
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ input, context }) => {
      await context.api.deleteEnvironment(input.id, input.environment);
      return { deleted: true as const };
    }),
};

function environmentView(row: SpaceEnvironmentRow) {
  return {
    id: row.id,
    machineName: row.machineName,
    name: row.name,
    kind: row.kind,
    createdFrom: row.createdFrom,
    createdMode: row.createdMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
