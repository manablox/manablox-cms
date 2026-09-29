import {
  type AuditAction,
  type AuditActor,
  auditor,
  ManabloxError,
  stagingIdOf,
} from '@manablox/core';
import { Hono } from 'hono';
import { type Runtime, requireManagement } from './bootstrap.js';
import { errorResponse, notFound } from './errors.js';
import { authGuard } from './middleware/auth-guard.js';
import { contentSecurityPolicy } from './middleware/csp.js';
import { stateGate } from './middleware/state-gate.js';
import {
  adminPluginRoutes,
  adminRoutes,
  inlineScriptHashes,
  resolveAdminDir,
} from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { realtimeRoutes } from './routes/realtime.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { transferRoutes } from './routes/transfer.js';
import { uploadRoutes } from './routes/upload.js';
import { mountControl } from './surfaces/control.js';
import { mountDelivery } from './surfaces/delivery.js';
import { mountGraphQL } from './surfaces/graphql.js';
import { mountMiddleware } from './surfaces/middleware.js';
import { resolveSurfaceMode, type SurfaceModeOptions } from './surfaces/mode.js';
import { pluginSurface } from './surfaces/plugins.js';
import { publicScopeOf, publicSpaceOf } from './surfaces/public-host.js';
import { mountRpc } from './surfaces/rpc.js';
import { mountServiceDocument } from './surfaces/service-document.js';

export type CreateAppOptions = SurfaceModeOptions;
export { resolvePinnedSpaceId } from './surfaces/mode.js';

/**
 * Builds the HTTP app: middleware, then one mount per configured scope, then a plugin mode's
 * surface. A public instance without a pinned space resolves each request's space from `Host`.
 */
export async function createApp(runtime: Runtime, options: CreateAppOptions = {}): Promise<Hono> {
  const app = new Hono();
  const mode = await resolveSurfaceMode(runtime, options);
  const { scopes } = mode;
  const surface = mode.plugin;

  const plugins = pluginSurface(runtime, mode);
  mountMiddleware(app, runtime, mode, (app) => plugins.middleware(app, 'beforeAuth'));
  app.route('/', healthRoutes(runtime));
  plugins.middleware(app, 'afterAuth');
  // After health, before every surface it gates.
  app.use('*', stateGate(runtime, mode));
  plugins.middleware(app, 'beforeRoutes');

  if (mode.isPublic) mountServiceDocument(app, runtime, mode);
  if (scopes.has('control')) mountControl(app, runtime);
  if (scopes.has('auth')) {
    // Tighter, audited limits for credential routes.
    app.use(
      '/api/auth/*',
      authGuard({
        store: runtime.rateLimitStore,
        policy: async () => {
          const rule = (await runtime.manablox.controls.resolved(null)).rateLimits['auth.signIn'];
          return rule && { attempts: rule.max, window: rule.windowSeconds * 1000 };
        },
        audit: (entry) => auditAuthFailure(runtime, entry),
        onError: (error) =>
          runtime.manablox.logger.warn({ err: error }, 'auth guard store unavailable'),
      }),
    );
    app.all('/api/auth/*', (c) => runtime.auth.handler(c.req.raw));
  }
  if (scopes.has('rpc')) {
    mountRpc(app, requireManagement(runtime));
    app.route('/', transferRoutes(runtime));
    app.route('/', snapshotRoutes(runtime));
    app.route('/', realtimeRoutes(runtime));
  }
  if (scopes.has('graphql')) mountGraphQL(app, runtime, mode);
  if (scopes.has('delivery')) mountDelivery(app, runtime, mode);
  if (scopes.has('media')) {
    app.route(
      '/',
      mediaRoutes(
        runtime,
        surface
          ? { publishedOnly: true, scope: surface.media ?? (async () => null) }
          : mode.isPublic
            ? {
                publishedOnly: true,
                scope: async (c) => {
                  const spaceId = publicSpaceOf(c);
                  return spaceId ? { spaceId, stagingId: stagingIdOf(publicScopeOf(c)) } : null;
                },
              }
            : {},
      ),
    );
  }
  if (scopes.has('uploads')) app.route('/', uploadRoutes(runtime));
  plugins.mount(app);
  surface?.mount(app);

  // Last, so it only gets unclaimed paths. Not on anonymous instances, which have no auth.
  const admin = runtime.manablox.config.server.admin;
  if (admin && !mode.anonymous) {
    const csp = runtime.manablox.config.server.csp;
    const dir = resolveAdminDir(admin.dir);
    if (csp.enabled) app.use('/*', contentSecurityPolicy(csp, inlineScriptHashes(dir)));
    app.route(
      '/',
      adminRoutes(dir, {
        plugins: runtime.manablox.config.plugins,
        logger: runtime.manablox.logger,
      }),
    );
  } else if (scopes.has('rpc') && !mode.anonymous) {
    // For an admin served elsewhere, e.g. the nginx image, which proxies these paths here.
    app.route('/', adminPluginRoutes(runtime.manablox.config.plugins, runtime.manablox.logger));
  }

  const fallback = surface?.fallback?.bind(surface);
  app.notFound(fallback ? (c) => fallback(c, 404) : notFound);
  app.onError((error, c) => {
    if (!ManabloxError.is(error)) {
      runtime.manablox.logger.error(
        { err: error, requestId: c.get('requestId') },
        'unhandled error',
      );
    }
    if (fallback) return fallback(c, 500);
    return errorResponse(c, error, { mask: mode.anonymous });
  });

  return app;
}

/** Records a refused sign-in without awaiting; `record` never throws. */
function auditAuthFailure(
  runtime: Runtime,
  entry: { action: AuditAction; label: string; detail: Record<string, unknown> },
): void {
  const actor: AuditActor = { kind: 'system', id: null, label: entry.label, detail: entry.detail };
  void auditor(runtime.repos, 'session', () => entry.label, { actor }).record(entry.action, {
    id: null,
  });
}
