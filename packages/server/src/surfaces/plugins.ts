import { assertCan, type Principal } from '@manablox/auth';
import {
  type Controls,
  isUuid,
  ManabloxError,
  type ManabloxPlugin,
  type Permission,
  type PluginCallback,
  type PluginContext,
  type PluginServer,
  pluginFeatureKey,
  pluginId,
  rateLimitExceeded,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Context, Hono, type MiddlewareHandler, type Next } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse } from '../errors.js';
import { clientIp } from '../middleware/client-ip.js';
import { principal, resolveRequestPrincipal } from '../middleware/principal.js';
import { withRateLimitHeaders } from '../middleware/rate-limit.js';
import { served } from '../middleware/served.js';
import { DELIVERY_METRICS, usageRefusal } from '../middleware/usage-gate.js';
import type { SurfaceMode } from './mode.js';
import { publicSpaceOf } from './public-host.js';

/** The server a plugin extension runs in, by `server.mode`: a core mode or a plugin mode's name. */
export type PluginServerScope = 'management' | 'public' | (string & {});

/** Where plugin middleware runs; see https://dev.manablox.io/extending/server-routes/. */
export type PluginMiddlewareOrder = 'beforeAuth' | 'afterAuth' | 'beforeRoutes';

/** `S` is the plugin's services. */
export interface PluginHelpers<S = unknown> {
  scope: PluginServerScope;
  manablox: Manablox;
  readonly controls: Controls;
  /** The instance logger, bound to the plugin. */
  logger: Manablox['logger'];
  /** The plugin's context: its services, repositories and jobs. */
  plugin: PluginContext<S>;
  /** The caller: a session or API key; `null` when anonymous, always outside management. */
  principal(c: Context): Promise<Principal | null>;
  /**
   * The request's space, validated and with the plugin on: `x-manablox-space`, the
   * `spaceId` path param or query on management, the served space on public, the mode's
   * `spaceOf` on a plugin mode. Writes also need it writable.
   */
  requireSpace(c: Context): Promise<string>;
  /**
   * Throws 401 without a caller and 403 without the permission. The space is the request's
   * (`requireSpace`) when omitted; `null` checks instance-wide, which only a superadmin passes.
   */
  requirePermission(
    c: Context,
    permission: Permission,
    spaceId?: string | null,
  ): Promise<Principal>;
  /**
   * Middleware counting the request against one of the plugin's rate rules, `rule` as the
   * controls take it (`plugins.<id>.<name>`, e.g. from `controlKeys`), which its `controls`
   * declare under `rateLimits.`, per client IP unless `key` says otherwise. Answers 429
   * `rateLimit.exceeded` once it is used up. The space whose controls set the limit is the one
   * the request names (a `spaceId` path param included), unless `spaceId` says otherwise.
   */
  rateLimit(rule: `plugins.${string}`, options?: PluginRateLimitOptions): MiddlewareHandler;
}

export interface PluginRateLimitOptions {
  /** The bucket; the client IP by default. */
  key?: (c: Context) => string | Promise<string>;
  /** The space whose controls set the limit; `null` for the instance's. */
  spaceId?: (c: Context) => string | null | Promise<string | null>;
}

export interface PluginRoutes<S = unknown> {
  scopes: readonly PluginServerScope[];
  /** Adds routes to a sub-app mounted at `/plugins/<id>`. */
  register(app: Hono, helpers: PluginHelpers<S>): void;
}

export type PluginMiddlewareHandler<S = unknown> = PluginCallback<
  [c: Context, next: Next, helpers: PluginHelpers<S>],
  ReturnType<MiddlewareHandler>
>;

export interface PluginMiddleware<S = unknown> {
  scopes: readonly PluginServerScope[];
  order: PluginMiddlewareOrder;
  /** A Hono path pattern; every path by default. */
  path?: string;
  handler: PluginMiddlewareHandler<S>;
}

declare module '@manablox/core' {
  interface PluginServer<S = unknown> {
    routes?: PluginRoutes<S>[];
    middleware?: PluginMiddleware<S>[];
  }
}

/** Types a plugin's `server` block; `S` types `helpers.plugin.services`. */
export function pluginServer<S = unknown>(server: PluginServer<S>): PluginServer<S> {
  return server;
}

interface PluginSurface {
  /** Registers the plugins' middleware of one order, in plugin order. */
  middleware(app: Hono, order: PluginMiddlewareOrder): void;
  /** Mounts the plugins' routes under `/plugins/<id>`. */
  mount(app: Hono): void;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Plugin routes and middleware for this process; refuses two route plugins with one id. */
export function pluginSurface(runtime: Runtime, mode: SurfaceMode): PluginSurface {
  const plugins = runtime.manablox.config.plugins;
  assertUniqueIds(plugins);
  const surface = surfaceScope(runtime, mode);
  const active = (scopes: readonly PluginServerScope[]) =>
    surface.scope !== null && scopes.includes(surface.scope);
  const enabled = async (plugin: ManabloxPlugin, spaceId: string | null) =>
    (await runtime.manablox.controls.feature(spaceId, pluginFeatureKey(plugin))).enabled;

  return {
    middleware(app, order) {
      for (const plugin of plugins) {
        const entries = (plugin.server?.middleware ?? []).filter(
          (entry) => entry.order === order && active(entry.scopes),
        );
        if (entries.length === 0) continue;
        const helpers = pluginHelpers(surface, plugin, order !== 'beforeAuth');
        for (const entry of entries) {
          app.use(entry.path ?? '*', async (c, next) => {
            if (!(await enabled(plugin, null))) return next();
            return entry.handler(c, next, helpers);
          });
        }
      }
    },

    mount(app) {
      for (const plugin of plugins) {
        const routes = (plugin.server?.routes ?? []).filter((entry) => active(entry.scopes));
        if (routes.length === 0) continue;
        const helpers = pluginHelpers(surface, plugin, true);
        const sub = pluginApp(surface, plugin);
        for (const entry of routes) entry.register(sub, helpers);
        sub.all('*', (c) => c.notFound());
        sub.onError((error, c) => {
          if (!ManabloxError.is(error)) {
            helpers.logger.error({ err: error, requestId: c.get('requestId') }, 'unhandled error');
          }
          return errorResponse(c, error, { mask: mode.anonymous });
        });
        app.route(`/plugins/${pluginId(plugin.name)}`, sub);
      }
    },
  };
}

/** The process's plugin scope and how a request's space and caller are read in it. */
interface SurfaceScope {
  runtime: Runtime;
  mode: SurfaceMode;
  /** `null` when this process runs no plugin extensions. */
  scope: PluginServerScope | null;
  /** The space the request names, unvalidated. */
  namedSpace(c: Context): Promise<string | null>;
  /** The caller, resolved once per request; always `null` outside management. */
  resolvePrincipal(c: Context): Promise<Principal | null>;
}

function surfaceScope(runtime: Runtime, mode: SurfaceMode): SurfaceScope {
  const modeSurface = mode.plugin;
  const scope: PluginServerScope | null = modeSurface
    ? mode.mode
    : mode.isPublic
      ? 'public'
      : mode.scopes.has('rpc')
        ? 'management'
        : null;

  const resolving = new WeakMap<Request, Promise<Principal | null>>();
  return {
    runtime,
    mode,
    scope,
    namedSpace: async (c) => {
      if (scope === 'public') return publicSpaceOf(c) ?? mode.pinnedSpaceId;
      if (modeSurface) return (await modeSurface.spaceOf?.(c)) ?? null;
      const named = spaceParam(c);
      return named && isUuid(named) ? named : null;
    },
    resolvePrincipal: (c) => {
      if (scope !== 'management') return Promise.resolve(null);
      const set = c.get('principal');
      if (set !== undefined) return Promise.resolve(set);
      let pending = resolving.get(c.req.raw);
      if (!pending) {
        pending = resolveRequestPrincipal(runtime, c.req.raw.headers);
        resolving.set(c.req.raw, pending);
      }
      return pending;
    },
  };
}

const spaceParam = (c: Context): string | null =>
  c.req.header('x-manablox-space') || c.req.param('spaceId') || c.req.query('spaceId') || null;

function pluginHelpers(
  surface: SurfaceScope,
  plugin: ManabloxPlugin,
  withPrincipal: boolean,
): PluginHelpers {
  const { manablox } = surface.runtime;
  const requireSpace = (c: Context) => requirePluginSpace(surface, plugin, c);
  const principalOf = withPrincipal ? surface.resolvePrincipal : async () => null;
  return {
    scope: surface.scope ?? 'management',
    manablox,
    get controls() {
      return manablox.controls;
    },
    logger: manablox.logger.child({ plugin: plugin.name }),
    plugin: manablox.plugin(plugin.name),
    principal: principalOf,
    requireSpace,
    rateLimit: (rule, options) => pluginRateLimit(surface, plugin, rule, options),
    requirePermission: async (c, permission, spaceId) => {
      const space = spaceId === undefined ? await requireSpace(c) : spaceId;
      const caller = await principalOf(c);
      assertCan(caller, space, permission);
      return caller as Principal;
    },
  };
}

/** `PluginHelpers.requireSpace`. */
async function requirePluginSpace(
  { runtime, scope, namedSpace }: SurfaceScope,
  plugin: ManabloxPlugin,
  c: Context,
): Promise<string> {
  const { manablox } = runtime;
  const named = scope === 'management' ? spaceParam(c) : null;
  if (scope === 'management' && !named) throw ManabloxError.badRequest('plugin.space.required');
  const spaceId = await namedSpace(c);
  if (!spaceId || !(await runtime.spaces.isReady(spaceId))) {
    throw ManabloxError.notFound('space.notFound', { spaceId: spaceId ?? named });
  }
  if (!(await pluginOn(manablox.controls, plugin, spaceId))) {
    throw ManabloxError.notFound('route.notFound', { path: c.req.path });
  }
  if (!SAFE_METHODS.has(c.req.method)) await manablox.controls.assertWritable(spaceId);
  return spaceId;
}

/**
 * Whether the plugin is on for the instance and `spaceId`. False while it is hidden, which
 * the caller answers as not found; while it is shown locked, throws 403 `control.feature`
 * with the lock's message and link, as its procedures answer.
 */
async function pluginOn(
  controls: Controls,
  plugin: ManabloxPlugin,
  spaceId: string | null,
): Promise<boolean> {
  const feature = pluginFeatureKey(plugin);
  const state = await controls.feature(spaceId, feature);
  if (state.enabled) return true;
  if (state.presentation === 'locked') await controls.assertFeature(spaceId, feature);
  return false;
}

/** `PluginHelpers.rateLimit`; throws at registration for a rule the plugin does not declare. */
function pluginRateLimit(
  { runtime, scope, namedSpace }: SurfaceScope,
  plugin: ManabloxPlugin,
  rule: `plugins.${string}`,
  options: PluginRateLimitOptions = {},
): MiddlewareHandler {
  const { manablox } = runtime;
  if (
    !rule.startsWith(`plugins.${pluginId(plugin.name)}.`) ||
    !plugin.controls?.[`rateLimits.${rule}`]
  ) {
    throw new Error(`Plugin ${plugin.name} declares no rate limit rateLimits.${rule}.`);
  }
  return async (c, next) => {
    const key = options.key ? await options.key(c) : clientIp(c);
    const named = options.spaceId
      ? await options.spaceId(c)
      : scope === 'management'
        ? spaceParam(c)
        : await namedSpace(c);
    const spaceId = named && isUuid(named) ? named : null;
    const decision = await manablox.controls.rate(spaceId, [{ rule, key }]);
    if (decision && !decision.allowed) {
      return withRateLimitHeaders(
        errorResponse(c, rateLimitExceeded(decision.rule, decision.retryAfter)),
        decision,
      );
    }
    await next();
    if (decision) withRateLimitHeaders(c.res, decision);
  };
}

/** A plugin's sub-app with the gates its routes run behind: feature, served, usage, writes. */
function pluginApp(
  { runtime, mode, scope, namedSpace }: SurfaceScope,
  plugin: ManabloxPlugin,
): Hono {
  const { manablox } = runtime;
  const sub = new Hono();
  // Off for the instance, or in the space the request names: as if absent while hidden,
  // refused with the lock while locked.
  sub.use('*', async (c, next) => {
    if (!(await pluginOn(manablox.controls, plugin, await namedSpace(c)))) return c.notFound();
    await next();
  });
  if (scope === 'public') {
    sub.use('*', served(manablox, { surface: () => 'delivery', spaceId: namedSpace }));
    sub.use('*', async (c, next) => {
      const refused = await usageRefusal(c, manablox, await namedSpace(c), DELIVERY_METRICS);
      return refused ?? next();
    });
  } else if (mode.plugin) {
    const surface = mode.plugin.served ?? 'delivery';
    sub.use('*', served(manablox, { surface: () => surface, spaceId: namedSpace }));
    sub.use('*', async (c, next) => {
      const refused = await usageRefusal(c, manablox, await namedSpace(c), ['bandwidthBytes']);
      return refused ?? next();
    });
  } else {
    sub.use('*', principal(runtime));
  }
  sub.use('*', async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      await manablox.controls.assertWritable(await namedSpace(c));
    }
    await next();
  });
  return sub;
}

/** Route paths are namespaced by id, so two plugins with routes may not share one. */
function assertUniqueIds(plugins: readonly ManabloxPlugin[]): void {
  const seen = new Map<string, string>();
  for (const plugin of plugins) {
    if (!plugin.server?.routes?.length) continue;
    const id = pluginId(plugin.name);
    const other = seen.get(id);
    if (other !== undefined) {
      throw ManabloxError.conflict('plugin.id.duplicate', { id, plugins: [other, plugin.name] });
    }
    seen.set(id, plugin.name);
  }
}
