import { REDIRECT_SOURCES } from '@manablox/core';
import { RedirectService } from '@manablox/services';
import { z } from 'zod';
import { scoped } from '../base.js';
import type { RpcContext } from '../context.js';
import {
  locale,
  pagination,
  payloadOf,
  searchTerm,
  spaceItem,
  spaceScoped,
  uuid,
} from '../schemas.js';

const built = new WeakMap<RpcContext['repos'], RedirectService>();

function redirects(context: RpcContext): RedirectService {
  if (context.redirects) return context.redirects;
  let own = built.get(context.repos);
  if (!own) {
    own = new RedirectService(context.manablox, context.repos);
    built.set(context.repos, own);
  }
  return own;
}

const redirectInput = z.object({
  locale: locale.nullable().optional(),
  fromPath: z.string().min(1).max(2000),
  /** A path or an absolute `http(s)` URL. */
  toPath: z.string().min(1).max(2000).nullable().optional(),
  /** A document's `localizationId`. */
  toContentId: uuid.nullable().optional(),
  status: z.union([z.literal(301), z.literal(302)]).optional(),
});

/** Redirects of a space. The rules are in `RedirectService`. */
export const redirectRouter = {
  list: scoped('redirect:read')
    .input(
      spaceScoped.extend({
        search: searchTerm.optional(),
        source: z.enum(REDIRECT_SOURCES).optional(),
        /** That locale's redirects plus the shared ones. */
        locale: locale.optional(),
        pagination: pagination({ limit: 50, max: 200 }),
      }),
    )
    .handler(async ({ input, context }) =>
      redirects(context).list(
        context.env,
        { search: input.search, source: input.source, locale: input.locale },
        input.pagination,
      ),
    ),

  get: scoped('redirect:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => redirects(context).get(context.env, input.id)),

  create: scoped('redirect:write')
    .input(spaceScoped.extend(redirectInput.shape))
    .handler(async ({ input, context }) => {
      const data = payloadOf(input);
      return redirects(context).create(context.env, data, context.principal?.userId ?? null);
    }),

  /** Saving an automatic redirect makes it manual. */
  update: scoped('redirect:write')
    .input(spaceItem.extend(redirectInput.shape))
    .handler(async ({ input, context }) => {
      const { id, ...data } = payloadOf(input);
      return redirects(context).update(context.env, id, data);
    }),

  delete: scoped('redirect:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await redirects(context).delete(context.env, input.id);
      return { ok: true };
    }),
};
