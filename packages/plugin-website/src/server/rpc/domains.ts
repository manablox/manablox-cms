import { type PluginRpcKit, payloadOf, schemas } from '@manablox/api-rpc/plugin';
import { z } from 'zod';
import type { WebsiteServices } from '../services/index.js';

const { locale, spaceItem, spaceScoped } = schemas;

const domainInput = z.object({
  hostname: z.string().min(1).max(260),
  locale: locale.nullable().optional(),
  isPrimary: z.boolean().optional(),
  redirectToPrimary: z.boolean().optional(),
});

/** Host names of a designed site. The rules are in `SiteDomainService`. */
export const domainProcedures = ({ scoped }: PluginRpcKit<WebsiteServices>) => ({
  list: scoped('website:read')
    .input(spaceScoped)
    .handler(async ({ context }) => context.plugin.services.domains.list(context.env)),

  /** The first host of a space and locale becomes its primary. */
  create: scoped('website:domains')
    .input(spaceScoped.extend(domainInput.shape))
    .handler(async ({ input, context }) => {
      const data = payloadOf(input);
      return context.plugin.services.domains.create(context.env, data);
    }),

  update: scoped('website:domains')
    .input(spaceItem.extend(domainInput.partial().shape))
    .handler(async ({ input, context }) => {
      const { id, ...data } = payloadOf(input);
      return context.plugin.services.domains.update(context.env, id, data);
    }),

  /** Checks the domain's DNS now. */
  verify: scoped('website:domains')
    .input(spaceItem)
    .handler(async ({ input, context }) =>
      context.plugin.services.domains.verify(context.env, input.id),
    ),

  delete: scoped('website:domains')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.plugin.services.domains.delete(context.env, input.id);
      return { ok: true };
    }),
});
