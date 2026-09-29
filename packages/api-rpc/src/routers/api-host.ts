import { ApiHostService } from '@manablox/services';
import { z } from 'zod';
import { scoped } from '../base.js';
import type { RpcContext } from '../context.js';
import { spaceItem, spaceScoped } from '../schemas.js';

const built = new WeakMap<RpcContext['repos'], ApiHostService>();

function apiHosts(context: RpcContext): ApiHostService {
  if (context.apiHosts) return context.apiHosts;
  let own = built.get(context.repos);
  if (!own) {
    own = new ApiHostService(context.manablox, context.repos);
    built.set(context.repos, own);
  }
  return own;
}

/** Host names the public API answers a space on. The rules are in `ApiHostService`. */
export const apiHostRouter = {
  list: scoped('space:read')
    .input(spaceScoped)
    .handler(async ({ context }) => apiHosts(context).list(context.env)),

  create: scoped('space:write')
    .input(spaceScoped.extend({ hostname: z.string().min(1).max(260) }))
    .handler(async ({ input, context }) => apiHosts(context).create(context.env, input.hostname)),

  /** Checks the host's DNS now. */
  verify: scoped('space:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => apiHosts(context).verify(context.env, input.id)),

  delete: scoped('space:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await apiHosts(context).delete(context.env, input.id);
      return { ok: true };
    }),
};
