import { z } from 'zod';
import { base } from '../base.js';
import { groupParam, groupSchema, groupWrite } from '../schemas.js';

export const groupRoutes = {
  list: base
    .route({ method: 'GET', path: '/groups', summary: 'Space groups', tags: ['groups'] })
    .output(z.object({ items: z.array(groupSchema) }))
    .handler(async ({ context }) => ({ items: await context.api.listGroups() })),

  get: base
    .route({ method: 'GET', path: '/groups/{id}', summary: 'One space group', tags: ['groups'] })
    .input(z.object({ id: groupParam }))
    .output(groupSchema)
    .handler(({ input, context }) => context.api.group(input.id)),

  create: base
    .route({
      method: 'POST',
      path: '/groups',
      summary: 'Create a space group',
      tags: ['groups'],
      successStatus: 201,
    })
    .input(groupWrite)
    .output(groupSchema)
    .handler(({ input, context }) => context.api.createGroup(input)),

  update: base
    .route({
      method: 'PATCH',
      path: '/groups/{id}',
      summary: 'Rename a group or change its external id',
      tags: ['groups'],
      inputStructure: 'detailed',
    })
    .input(z.object({ params: z.object({ id: groupParam }), body: groupWrite.partial() }))
    .output(groupSchema)
    .handler(({ input, context }) => context.api.updateGroup(input.params.id, input.body)),

  delete: base
    .route({
      method: 'DELETE',
      path: '/groups/{id}',
      summary: 'Delete a group and its values; its spaces stay',
      tags: ['groups'],
    })
    .input(z.object({ id: groupParam }))
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ input, context }) => {
      await context.api.deleteGroup(input.id);
      return { deleted: true as const };
    }),

  setSpaces: base
    .route({
      method: 'PUT',
      path: '/groups/{id}/spaces',
      summary: "Replace a group's spaces",
      tags: ['groups'],
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ id: groupParam }),
        body: z.object({ spaceIds: z.array(z.uuid()).max(10_000) }),
      }),
    )
    .output(groupSchema)
    .handler(({ input, context }) =>
      context.api.setGroupSpaces(input.params.id, input.body.spaceIds),
    ),
};
