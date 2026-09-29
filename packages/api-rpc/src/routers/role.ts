import { z } from 'zod';
import { authed, scoped } from '../base.js';
import { machineName, spaceItem, spaceScoped, uuid } from '../schemas.js';

const roleSchema = spaceScoped.extend({
  name: z.string().trim().min(1).max(100),
  machineName,
  description: z.string().max(500).nullable().optional(),
  /** `space:write`, `content:read` for every type, `content:read:<typeId>` for one. */
  permissions: z.array(z.string().max(120)).max(500),
});

/** A space's roles. The rules are in `RoleService`. */
export const roleRouter = {
  /** The grouped permission catalogue. */
  catalog: authed.handler(async ({ context }) => context.roles.catalog()),

  list: scoped('role:read')
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.roles.list(input.spaceId)),

  get: scoped('role:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => context.roles.get(input.spaceId, input.id)),

  create: scoped('role:write')
    .input(roleSchema)
    .handler(async ({ input, context }) => {
      const { spaceId, ...data } = input;
      return context.roles.create(spaceId, data);
    }),

  update: scoped('role:write')
    .input(roleSchema.extend({ id: uuid }))
    .handler(async ({ input, context }) => {
      const { spaceId, id, ...data } = input;
      return context.roles.update(spaceId, id, data);
    }),

  delete: scoped('role:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.roles.delete(input.spaceId, input.id);
      return { ok: true };
    }),
};
