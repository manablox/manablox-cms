/** The entry for plugin routers: builders with the core guards, schemas and context types. */

import {
  isUuid,
  ManabloxError,
  type ManabloxPlugin,
  type Permission,
  type PluginContext,
  type PluginLookup,
  pluginFeatureKey,
  type ResolvedFeature,
} from '@manablox/core';
import { type AnyRouter, isProcedure, os, type RouterClient } from '@orpc/server';

/**
 * The oRPC types the routers of plugin packages refer to, so a plugin's declarations can name
 * them through this entry without depending on oRPC itself.
 */
export type { AnySchema, ErrorMap, MergedErrorMap, Meta, Schema } from '@orpc/contract';
export type {
  Context,
  DecoratedProcedure,
  Lazy,
  MergedCurrentContext,
  MergedInitialContext,
  Procedure,
  Router,
} from '@orpc/server';

import {
  authedMiddleware,
  instanceWritableMiddleware,
  scopedMiddleware,
  scopedSpaceId,
  stateMiddleware,
  superadminMiddleware,
} from './base.js';
import type { RpcContext } from './context.js';

export { toOrpcError } from './base.js';
export type { RpcContext, RpcRuntime } from './context.js';
export {
  allowedTypeIdsIn,
  assertOnDocument,
  assertOnType,
  grantTypeId,
  narrowToAllowed,
  toActor,
} from './guards.js';
export * as schemas from './schemas.js';
export { payloadOf } from './schemas.js';

/** A plugin procedure's context: the core one plus the plugin's own and the other plugins. */
export type PluginRpcContext<S = unknown> = RpcContext & {
  plugin: PluginContext<S>;
  plugins: PluginLookup;
};

const rpc = os.$context<RpcContext>();
/** The first plugin middleware of every procedure a kit builds; the server checks for it. */
const gates = new WeakSet<object>();

/** Options of a kit's `scoped`. */
export interface PluginScopedOptions {
  /**
   * Also answers while the plugin is locked (switched off but shown) for the instance or the
   * space, for what the admin needs to draw the lock, e.g. whether the space has anything the
   * locked control would use. Hidden still answers not found.
   */
  locked?: boolean;
  /** Further permissions the caller needs in the input's space, e.g. `ai:use` for a design. */
  also?: readonly Permission[];
}

/**
 * Procedure builders for one plugin: the core `base`, `authed`, `scoped`, `superadmin` and
 * `superadminWrite`, refusing while the plugin is off for the instance or the input's space
 * (not found while hidden, 403 `control.feature` while locked), with `context.plugin` set.
 */
export function pluginRpcKit<S = unknown>(plugin: Pick<ManabloxPlugin, 'name'>) {
  const feature = pluginFeatureKey(plugin);
  const notFound = (path: readonly string[]) =>
    ManabloxError.notFound('route.notFound', { path: path.join('.') });
  const allows = (state: ResolvedFeature, locked: boolean) =>
    state.enabled || (locked && state.presentation === 'locked');

  /**
   * Refuses a call while the plugin is off: 404 while it is hidden, 403 `control.feature`
   * with the lock's message and link while it is shown locked.
   */
  const refuse = async (
    context: RpcContext,
    spaceId: string | null,
    state: ResolvedFeature,
    path: readonly string[],
  ): Promise<never> => {
    if (state.presentation === 'locked')
      await context.manablox.controls.assertFeature(spaceId, feature);
    throw notFound(path);
  };

  const gateOf = (locked: boolean) => {
    const gate = rpc.middleware(async ({ context, next, path }) => {
      const state = await context.manablox.controls.feature(null, feature);
      if (!allows(state, locked)) await refuse(context, null, state, path);
      return next({
        context: {
          plugin: context.manablox.plugin<S>(plugin.name),
          plugins: context.manablox.plugins,
        },
      });
    });
    gates.add(gate);
    return gate;
  };

  const spaceGateOf = (locked: boolean) =>
    rpc.middleware(async ({ context, next, path }, input: unknown) => {
      const spaceId = scopedSpaceId(input);
      if (isUuid(spaceId)) {
        const state = await context.manablox.controls.feature(spaceId, feature);
        if (!allows(state, locked)) await refuse(context, spaceId, state, path);
      }
      return next();
    });

  const base = rpc.use(stateMiddleware).use(gateOf(false));
  const authed = base.use(authedMiddleware);
  const lockedAuthed = rpc.use(stateMiddleware).use(gateOf(true)).use(authedMiddleware);
  const spaceGate = spaceGateOf(false);
  const lockedSpaceGate = spaceGateOf(true);
  const superadmin = authed.use(superadminMiddleware);
  return {
    base,
    authed,
    /** `scoped` of the core routers; a permission may be one of the plugin's. */
    scoped: (permission: Permission, options: PluginScopedOptions = {}) =>
      options.locked
        ? lockedAuthed.use(lockedSpaceGate).use(scopedMiddleware(permission, options.also))
        : authed.use(spaceGate).use(scopedMiddleware(permission, options.also)),
    superadmin,
    superadminWrite: superadmin.use(instanceWritableMiddleware),
  };
}

export type PluginRpcKit<S = unknown> = ReturnType<typeof pluginRpcKit<S>>;

/**
 * A check for a kit's procedures, after its own gates: `kit.scoped(...).use(pluginGuard(fn))`.
 * `fn` throws to refuse the call.
 */
export function pluginGuard<S = unknown>(
  check: (context: PluginRpcContext<S>) => void | Promise<void>,
) {
  return os.$context<PluginRpcContext<S>>().middleware(async ({ context, next }) => {
    await check(context);
    return next();
  });
}

/** A plugin's router: nested objects of procedures built from its kit. */
export type PluginRouter = AnyRouter;

/** The router a plugin's `rpc` function builds. */
export type PluginRouterOf<F> = F extends (kit: never) => infer R ? R : never;

/** The typed client of a plugin router, as `plugins.<id>` of the management client. */
export type PluginRouterClient<R extends PluginRouter> = RouterClient<R>;

/** Procedures in `router` built without a kit, by dotted path. */
export function unguardedProcedures(router: PluginRouter, prefix: string[] = []): string[] {
  if (isProcedure(router)) {
    const middlewares = router['~orpc'].middlewares as readonly object[];
    return middlewares.some((middleware) => gates.has(middleware)) ? [] : [prefix.join('.')];
  }
  if (typeof router !== 'object' || router === null) return [prefix.join('.')];
  return Object.entries(router).flatMap(([key, value]) =>
    unguardedProcedures(value as PluginRouter, [...prefix, key]),
  );
}

declare module '@manablox/core' {
  interface ManabloxPlugin<S> {
    /** A router mounted at `plugins.<id>` of the management API; see https://dev.manablox.io/extending/rpc/. */
    rpc?(kit: PluginRpcKit<S>): PluginRouter;
  }
}
