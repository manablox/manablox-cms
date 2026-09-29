import { contentTypePlan } from '@manablox/api-rpc';
import { SPACE_BLOCK_IDS, SPACE_TEMPLATE_IDS } from '@manablox/core';
import { z } from 'zod';
import { base } from '../base.js';
import { apiHostList, groupParam, locale, spaceSchema } from '../schemas.js';

export const spaceRoutes = {
  list: base
    .route({
      method: 'GET',
      path: '/spaces',
      summary: 'Spaces with group, hosts and counts',
      tags: ['spaces'],
    })
    .output(z.object({ items: z.array(spaceSchema) }))
    .handler(async ({ context }) => ({ items: await context.api.listSpaces() })),

  get: base
    .route({ method: 'GET', path: '/spaces/{id}', summary: 'One space', tags: ['spaces'] })
    .input(z.object({ id: z.string().min(1).max(100) }))
    .output(spaceSchema)
    .handler(({ input, context }) => context.api.space(input.id)),

  create: base
    .route({
      method: 'POST',
      path: '/spaces',
      summary: 'Provision a space owned by the superadmins',
      tags: ['spaces'],
      successStatus: 201,
    })
    .input(
      z.object({
        name: z.string().min(1).max(200),
        machineName: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*$/)
          .max(64),
        description: z.string().max(2000).nullable().optional(),
        url: z.url().optional().describe('Frontend origin; defaults to the public URL.'),
        defaultLocale: locale.default('en'),
        locales: z.array(locale).min(1).optional(),
        starter: z
          .union([z.boolean(), z.enum(SPACE_TEMPLATE_IDS)])
          .default(false)
          .describe('A website starter; `true` is `basic`.'),
        blocks: z.array(z.enum(SPACE_BLOCK_IDS)).max(SPACE_BLOCK_IDS.length).optional(),
        group: groupParam.optional().describe('A group id, or `ext:<externalId>`, to join.'),
        apiHosts: apiHostList.optional(),
        plugins: z
          .record(z.string().min(1).max(100), z.unknown())
          .optional()
          .describe("Plugins' data for the new space, by plugin id."),
        plan: contentTypePlan
          .optional()
          .describe(
            'Content types to add after the starter, as `contentTypes.applyPlan` takes them.',
          ),
      }),
    )
    .output(
      spaceSchema.extend({
        warnings: z
          .array(z.string())
          .describe('What plugins could not finish once the space existed; the space stays.'),
      }),
    )
    .handler(({ input, context }) => {
      const { locales, url, ...rest } = input;
      return context.api.createSpace({
        ...rest,
        url: url ?? context.runtime.manablox.config.server.publicUrl,
        locales: locales ?? [input.defaultLocale],
      });
    }),

  setApiHosts: base
    .route({
      method: 'PUT',
      path: '/spaces/{id}/api-hosts',
      summary: "Replace a space's API hosts",
      tags: ['spaces'],
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ id: z.string().min(1).max(100) }),
        body: z.object({ hostnames: apiHostList }),
      }),
    )
    .output(spaceSchema)
    .handler(({ input, context }) =>
      context.api.setApiHosts(input.params.id, input.body.hostnames),
    ),
};
