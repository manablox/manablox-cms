import { CONTROL_CATALOGUE_VERSION } from '@manablox/core';
import { type MigrationStatus, migrationStatus } from '@manablox/db';
import { z } from 'zod';
import { base } from '../base.js';
import { resolvedState, stateSchema } from '../schemas.js';
import { readServerVersion } from '../version.js';

export const instance = base
  .route({ method: 'GET', path: '/instance', summary: 'Version and health', tags: ['instance'] })
  .output(
    z.object({
      version: z.string(),
      catalogueVersion: z.string(),
      schemaVersion: z.number().describe('Content-type registry version.'),
      migrations: z
        .object({
          latest: z.string().nullable(),
          applied: z.string().nullable(),
          pending: z.number(),
          plugins: z.array(
            z.object({
              id: z.string(),
              latest: z.string().nullable(),
              applied: z.string().nullable(),
              pending: z.number(),
            }),
          ),
        })
        .nullable(),
      health: z.object({
        status: z.enum(['ok', 'degraded']),
        database: z.enum(['ok', 'unavailable']),
      }),
    }),
  )
  .handler(async ({ context }) => {
    const { runtime } = context;
    const database = await runtime.handle.ping().then(
      () => 'ok' as const,
      () => 'unavailable' as const,
    );
    let migrations: MigrationStatus | null = null;
    if (database === 'ok') {
      migrations = await migrationStatus(runtime.handle, runtime.manablox.config.plugins).catch(
        (error: unknown) => {
          runtime.manablox.logger.warn({ err: error }, 'migration status unavailable');
          return null;
        },
      );
    }
    return {
      version: readServerVersion(),
      catalogueVersion: CONTROL_CATALOGUE_VERSION,
      schemaVersion: runtime.manablox.contentTypes.schemaVersion,
      migrations,
      health: { status: database === 'ok' ? ('ok' as const) : ('degraded' as const), database },
    };
  });

export const instanceState = base
  .route({
    method: 'PUT',
    path: '/instance/state',
    summary: 'Set the instance state',
    tags: ['instance'],
  })
  .input(stateSchema)
  .output(stateSchema)
  .handler(({ input, context }) =>
    context.api.setInstanceState({
      status: input.status,
      ...(input.message !== undefined ? { message: input.message } : {}),
    }),
  );

export const state = base
  .route({
    method: 'GET',
    path: '/state',
    summary: 'Resolved state and switched-off features per scope',
    tags: ['instance'],
  })
  .output(
    z.object({
      version: z.string(),
      scopes: z.array(
        z.object({
          scope: z.string(),
          group: z.string().nullable().optional(),
          state: resolvedState,
          featuresOff: z.array(z.string()),
        }),
      ),
      usage: z
        .record(
          z.string(),
          z.record(
            z.string(),
            z.object({
              level: z.enum(['warn', 'over', 'blocked']),
              used: z.number(),
              max: z.number(),
              resetsAt: z.string(),
            }),
          ),
        )
        .describe(
          'Metrics that are not `ok`, by scope label and metric; scopes with none are left out.',
        ),
    }),
  )
  .handler(({ context }) => context.api.state());
