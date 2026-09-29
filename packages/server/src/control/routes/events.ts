import { CONTROL_EVENT_TYPES } from '@manablox/core';
import { z } from 'zod';
import { base } from '../base.js';

export const events = base
  .route({
    method: 'GET',
    path: '/events',
    summary: 'Control events after a sequence number, oldest first',
    tags: ['events'],
  })
  .input(
    z.object({
      after: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('The `seq` of the last event seen; `0` from the start.'),
      limit: z.coerce.number().int().min(1).max(1000).default(100),
    }),
  )
  .output(
    z.object({
      items: z.array(
        z.object({
          seq: z.number(),
          id: z.string(),
          type: z.enum(CONTROL_EVENT_TYPES),
          scope: z.string().describe('`instance`, `group:<id>` or `space:<id>`.'),
          payload: z.record(z.string(), z.unknown()),
          createdAt: z.string(),
          deliveredAt: z
            .string()
            .nullable()
            .describe('When a push was acknowledged; `null` before, or without push.'),
        }),
      ),
      next: z.number().describe('The `after` for the next page; unchanged when nothing is new.'),
    }),
  )
  .handler(({ input, context }) => context.api.events(input.after, input.limit));
