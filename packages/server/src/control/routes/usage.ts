import { EXTERNAL_USAGE_METRICS, USAGE_METRICS } from '@manablox/services';
import { z } from 'zod';
import { base } from '../base.js';
import { period, scopeParam, usageMetrics } from '../schemas.js';

export const usageRoutes = {
  get: base
    .route({
      method: 'GET',
      path: '/usage',
      summary: 'Counted, external and total usage of a scope per metric',
      tags: ['usage'],
    })
    .input(
      z.object({
        scope: scopeParam,
        period: period.optional().describe('`YYYY-MM`; the current period when omitted.'),
      }),
    )
    .output(
      z.object({
        scope: z.string(),
        period: z.string(),
        start: z.string(),
        end: z.string(),
        metrics: usageMetrics,
        unattributed: z
          .object(
            Object.fromEntries(USAGE_METRICS.map((metric) => [metric, z.number()])) as Record<
              (typeof USAGE_METRICS)[number],
              z.ZodNumber
            >,
          )
          .catchall(z.number())
          .nullable()
          .describe(
            'Scope `instance` only: counts no space could be named for, e.g. delivery without a space. Not part of `metrics`.',
          ),
      }),
    )
    .handler(({ input, context }) => context.api.usage(input.scope, input.period)),

  external: base
    .route({
      method: 'POST',
      path: '/usage/external',
      summary: 'Report usage the CMS did not serve, e.g. CDN cache hits',
      tags: ['usage'],
    })
    .input(
      z
        .object({
          idempotencyKey: z
            .string()
            .min(1)
            .max(255)
            .describe('Stored once; a repeat with the same values changes nothing.'),
          spaceId: z.string().min(1).max(100).optional(),
          host: z
            .string()
            .min(1)
            .max(300)
            .optional()
            .describe("A plugin host name, an API host or the host of a space's frontend URL."),
          metric: z.enum(EXTERNAL_USAGE_METRICS),
          period,
          value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          mode: z
            .enum(['add', 'set'])
            .describe('`add` adds to the period; `set` replaces what was reported before.'),
        })
        .refine((body) => (body.spaceId === undefined) !== (body.host === undefined), {
          message: 'Send exactly one of spaceId and host.',
          path: ['spaceId'],
        }),
    )
    .output(
      z.object({
        spaceId: z.string(),
        metric: z.enum(EXTERNAL_USAGE_METRICS),
        period: z.string(),
        mode: z.enum(['add', 'set']),
        value: z.number(),
        duplicate: z.boolean().describe('The key was stored before; nothing changed.'),
        external: z.number().describe("The space's external figure for the period now."),
      }),
    )
    .handler(({ input, context }) => context.api.externalUsage(input)),
};
