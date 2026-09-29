import { CREDENTIAL_KINDS } from '@manablox/core';
import { z } from 'zod';
import { scoped } from '../base.js';
import { pagination, spaceItem, spaceScoped, uuid } from '../schemas.js';

const credentialSchema = spaceScoped.extend({
  name: z.string().max(200),
  slug: z.string().max(200).optional(),
  kind: z.enum(CREDENTIAL_KINDS),
  provider: z.string().max(120).optional(),
  /** An omitted secret field keeps the stored value. */
  data: z.record(z.string().max(120), z.string().max(8000)).default({}),
});

/** The space's credential vault, shared by every environment. The rules are in `CredentialService`. */
export const credentialRouter = {
  /** A page of the space's credentials by name, without secrets. */
  list: scoped('credential:read')
    .input(spaceScoped.extend({ pagination: pagination({ limit: 100, max: 500 }) }))
    .handler(async ({ input, context }) =>
      context.credentials.page(input.spaceId, input.pagination),
    ),

  create: scoped('credential:write')
    .input(credentialSchema)
    .handler(async ({ input, context }) => {
      const { spaceId, environment: _environment, ...data } = input;
      return context.credentials.create(spaceId, data);
    }),

  update: scoped('credential:write')
    .input(credentialSchema.extend({ id: uuid }))
    .handler(async ({ input, context }) => {
      const { spaceId, environment: _environment, id, ...data } = input;
      return context.credentials.update(spaceId, id, data);
    }),

  delete: scoped('credential:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.credentials.delete(input.spaceId, input.id);
      return { ok: true };
    }),
};
