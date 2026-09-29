import {
  ManabloxError,
  type ManabloxPlugin,
  type PluginContext,
  type PluginServerMode,
  pluginServerModes,
  type RateLimitRuleName,
  type RequestSurface,
  type ServerMode,
  type ServerScope,
} from '@manablox/core';
import type { Context, Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import type { MediaScope } from '../routes/media.js';

/** What a plugin mode's `surface` gets. */
export interface PluginModeContext<S = unknown> {
  runtime: Runtime;
  /** The declaring plugin's context. */
  plugin: PluginContext<S>;
}

/** A plugin mode's HTTP surface; anonymous and read-only, like `public`. */
export interface PluginModeSurface {
  /** Mounts the mode's routes, after core scopes and plugin routes. */
  mount(app: Hono): void;
  /** The space a request is for: rate limits, metering and the plugin routes of the mode. */
  spaceOf?(c: Context): Promise<string | null>;
  /** The usage surface its requests count toward; `delivery` by default. */
  served?: RequestSurface;
  /** The per-IP rate rule; `delivery.ip` by default. */
  rateRule?: RateLimitRuleName;
  /** The rule's fallback; `server.rateLimit` when absent. */
  rateLimit?: { window: number; max: number } | false;
  /** Restricts `/media` (the `media` scope) per request; nothing is served without it. */
  media?(c: Context): Promise<MediaScope | null>;
  /** Answers unmatched paths, errors and a suspended instance; JSON errors by default. */
  fallback?(c: Context, status: 404 | 500 | 503): Response;
  /** Paths that keep answering while the instance is suspended. */
  unsuspended?(path: string): boolean;
  /**
   * Changes to `PLUGIN_MODE_HEADERS`, which core sets on every response lacking them: a
   * value replaces or adds a header, `null` drops it.
   */
  headers?: Readonly<Record<string, string | null>>;
}

declare module '@manablox/core' {
  interface PluginServerMode<S = unknown> {
    /** Builds the surface once per app. */
    surface(context: PluginModeContext<S>): PluginModeSurface | Promise<PluginModeSurface>;
  }
}

/** Types a plugin mode; `S` types `context.plugin.services`. */
export function pluginMode<S = unknown>(mode: PluginServerMode<S>): PluginServerMode<S> {
  return mode;
}

export interface SurfaceModeOptions {
  /** Overrides `server.mode`; a definition replaces the configured mode of that name. */
  mode?: ServerMode | PluginServerMode;
  /** The pinned space for a public instance; from `publicApi` config when omitted. */
  spaceId?: string;
}

/** A core or plugin mode and its derived settings, computed once. */
export interface SurfaceMode {
  mode: ServerMode;
  isPublic: boolean;
  /** A plugin mode's surface; `null` on core modes. */
  plugin: PluginModeSurface | null;
  /** No accounts: errors are masked, the rate limit is per IP and the admin is not served. */
  anonymous: boolean;
  scopes: ReadonlySet<ServerScope>;
  /** A public instance's configured space; `null` resolves the space from `Host`. */
  pinnedSpaceId: string | null;
  /** `s-maxage` for delivery responses. */
  cacheTtl: number;
  rateLimit: { window: number; max: number } | false | undefined;
}

export async function resolveSurfaceMode(
  runtime: Runtime,
  options: SurfaceModeOptions = {},
): Promise<SurfaceMode> {
  const { config } = runtime.manablox;
  const requested = options.mode ?? config.server.mode;
  const mode = typeof requested === 'string' ? requested : requested.name;
  const declared = declaredMode(config.plugins, mode);
  const isPublic = mode === 'public';
  const definition = typeof requested === 'string' ? declared?.mode : requested;
  const plugin =
    declared && definition
      ? await definition.surface({ runtime, plugin: runtime.manablox.plugin(declared.plugin) })
      : null;
  const publicConfig = config.publicApi;

  return {
    mode,
    isPublic,
    plugin,
    anonymous: isPublic || plugin !== null,
    scopes: new Set(config.server.scopes),
    pinnedSpaceId: isPublic ? (options.spaceId ?? (await resolvePinnedSpaceId(runtime))) : null,
    cacheTtl: publicConfig.cacheTtl ?? config.cache.ttl,
    rateLimit: isPublic
      ? (publicConfig.rateLimit ?? config.server.rateLimit)
      : plugin?.rateLimit !== undefined
        ? plugin.rateLimit
        : config.server.rateLimit,
  };
}

/** The plugin mode named `name`; `null` for core modes. */
function declaredMode(
  plugins: readonly ManabloxPlugin[],
  name: string,
): { plugin: string; mode: PluginServerMode } | null {
  if (name === 'management' || name === 'public') return null;
  const found = pluginServerModes(plugins).get(name);
  if (!found) throw ManabloxError.badRequest('config.mode.unknown', { mode: name });
  return { plugin: found.plugin.name, mode: found.mode };
}

/** The public instance's configured space, by id or machine name; `null` when none is set. */
export async function resolvePinnedSpaceId(runtime: Runtime): Promise<string | null> {
  const config = runtime.manablox.config.publicApi;

  if (config.spaceId) {
    const space = await runtime.repos.spaces.findById(config.spaceId);
    if (!space) {
      throw ManabloxError.notFound('publicApi.space.notFound', { spaceId: config.spaceId });
    }
    return space.id;
  }

  if (config.spaceMachineName) {
    const space = await runtime.repos.spaces.findByMachineName(config.spaceMachineName);
    if (!space) {
      throw ManabloxError.notFound('publicApi.space.notFound', {
        machineName: config.spaceMachineName,
      });
    }
    return space.id;
  }

  return null;
}
