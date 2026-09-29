import type { RpcRuntime } from '@manablox/api-rpc';
import { attachBootstrapOwner } from '@manablox/auth';
import { attachCache, attachRegistrySync, createCache, redisHub } from '@manablox/cache';
import { type ManabloxConfig, ManabloxError, type ServerMode } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { createDatabase, createRepositories, databaseRoleWarning } from '@manablox/db';
import { FLUSH_USAGE_EVERY_MS, type JobSchedule, MAINTENANCE_SCHEDULE } from '@manablox/jobs';
import {
  type ApiHostService,
  attachAssetUsages,
  type ControlEventDelivery,
  createMailer,
  type EnvironmentLifecycleService,
  installControls,
  loadInstance,
  RealtimeService,
  type RedirectService,
  type SnapshotService,
} from '@manablox/services';
import { countQuery } from './middleware/query-count.js';
import { bootPlugins, checkPluginResources, startPlugins } from './plugin-runtime.js';
import {
  accountServices,
  coreJobs,
  coreServices,
  createRateLimitStore,
  type ManagementServices,
  managementServices,
  type RuntimeBase,
} from './runtime-services.js';

export type { ManagementServices } from './runtime-services.js';

type OptionalRpcKey = 'redirects' | 'apiHosts';

export interface ManagementRuntime
  extends Omit<RuntimeBase, OptionalRpcKey | 'snapshots'>,
    Omit<ManagementServices, 'environmentLifecycle'>,
    RpcRuntime {
  mode: 'management';
  snapshots: SnapshotService;
  environmentLifecycle: EnvironmentLifecycleService;
  redirects: RedirectService;
  apiHosts: ApiHostService;
}

/**
 * A read-only instance, the public delivery API or a plugin mode: no mail, push, notifications
 * or approvals.
 */
export interface PublicRuntime extends RuntimeBase {
  /** `public` or a plugin mode's name. */
  mode: Exclude<ServerMode, 'management'>;
}

export type Runtime = ManagementRuntime | PublicRuntime;

/** Narrows to a management runtime; mounting a management surface on a public one fails. */
export function requireManagement(runtime: Runtime): ManagementRuntime {
  if (runtime.mode !== 'management') {
    throw ManabloxError.badRequest('publicApi.scope.managementOnly');
  }
  return runtime as ManagementRuntime;
}

/** Composition root. Exposed surfaces are chosen by `server.scopes`. */
export async function bootstrap(config: ManabloxConfig): Promise<Runtime> {
  const { manablox, handle, repos, realtime } = await openInstance(config);
  const isManagement = manablox.config.server.mode === 'management';

  // Built before auth, which sends reset mails through it.
  const mailer = isManagement ? createMailer(manablox.config.mail, manablox.logger) : null;
  const rateLimitStore = createRateLimitStore(manablox);
  const { authMails, ...accounts } = accountServices(manablox, handle, repos, {
    mailer,
    // Grants go through `spaces`, built further down.
    addMembers: (...args) => services.spaces.addMembers(...args),
  });

  const cache = createCache(manablox.config.cache, { redis: redisHub(manablox)?.command });
  attachCache(manablox, cache);
  const controlStore = installControls(manablox, repos);
  controlStore.rates = rateLimitStore;
  // Content types saved by another process on the same database.
  await attachRegistrySync(manablox, {
    load: () => repos.contentTypes.listAll(),
    loadSpace: (spaceId) => repos.contentTypes.listOfSpace(spaceId),
    fingerprint: () => repos.contentTypes.fingerprint(),
  });

  const { jobs, jobHandlers, eventDelivery } = coreJobs(manablox, repos, controlStore, () => base);
  const services = coreServices(manablox, repos, {
    jobs,
    controlStore,
    users: accounts.users,
    authMails,
    afterRestore: async (spaceId) => {
      await managed?.codeResources.sync({ spaceIds: [spaceId] });
    },
  });

  const base: RuntimeBase = {
    manablox,
    handle,
    repos,
    ...accounts,
    cache,
    controlStore,
    rateLimitStore,
    ...services,
    realtime,
    jobs,
    shutdown: () => manablox.stop(),
  };
  const managed = isManagement ? managementServices(base, mailer) : null;
  // After core, so plugin job names cannot take a core one.
  const pluginSchedule = bootPlugins({
    ...base,
    jobHandlers,
    core: {
      ...base,
      credentials: managed?.credentials ?? null,
      mailer: managed?.mailer ?? null,
      pusher: managed?.pusher ?? null,
    },
  });
  attachSubscribers(base, managed);

  manablox.onDispose(() => handle.close());
  await manablox.start();
  controlStore.usageState?.start();
  if (!managed) {
    // With Redis the management worker flushes every process's usage.
    if (jobs.inline) await jobs.schedule({ 'controls:flushUsage': FLUSH_USAGE_EVERY_MS });
    return { ...base, mode: manablox.config.server.mode };
  }
  await startManagement(base, managed, { eventDelivery, pluginSchedule });
  return { ...base, ...managed, mode: 'management' };
}

/** The instance, its database and repositories, and the content type registry loaded. */
async function openInstance(config: ManabloxConfig) {
  const manablox = new Manablox(config);
  const handle = await createDatabase(manablox.config.database, { onQuery: countQuery });
  if (manablox.config.server.mode === 'management') {
    const warning = databaseRoleWarning(
      manablox.config.database,
      process.env.NODE_ENV === 'production',
    );
    if (warning) manablox.logger.warn(warning);
  }
  const realtime = new RealtimeService(manablox);

  // The registry needs runtime content types before anything reads it.
  const repos = createRepositories(handle, manablox.contentTypes, {
    audit: {
      // The action already happened, so log rather than throw.
      onError: (error, input) =>
        manablox.logger.error({ err: error, action: input.action }, 'audit entry not written'),
      // Audit entries drive admin realtime updates.
      onAppended: (row) => realtime.publishAudit(row),
    },
  });
  await loadInstance(manablox, repos);
  await manablox.init(await repos.contentTypes.listAll());
  // A broken code resource of a plugin kind stops the start, like a broken content type.
  checkPluginResources(manablox);
  return { manablox, handle, repos, realtime };
}

/** Content lifecycle subscribers. */
function attachSubscribers(base: RuntimeBase, managed: ManagementServices | null): void {
  const { manablox, repos, users } = base;
  attachAssetUsages(manablox, base.content);
  base.menus.attach();
  base.tags.attach();
  base.spaces.attach();
  attachBootstrapOwner(manablox, repos, { provisioned: () => users.provisioned() });
  managed?.notifications.attach();
  managed?.approvals.attach();
}

/** Scheduled work, long-running plugin work and, with `resources.apply: boot`, a resource sync. */
async function startManagement(
  base: RuntimeBase,
  managed: ManagementServices,
  started: { eventDelivery: ControlEventDelivery | null; pluginSchedule: JobSchedule },
): Promise<void> {
  const { manablox, jobs } = base;
  managed.schedule.start();
  const { 'controls:deliverEvents': deliverEvery, ...maintenance } = MAINTENANCE_SCHEDULE;
  await jobs.schedule({
    ...maintenance,
    ...(started.eventDelivery ? { 'controls:deliverEvents': deliverEvery } : {}),
    ...started.pluginSchedule,
  });
  // Long-running plugin work lives where the scheduled work does.
  await startPlugins(manablox);
  // The default `manual` waits for `manablox sync`.
  if (manablox.config.resources.apply === 'boot') {
    const report = await managed.codeResources.sync();
    manablox.logger.info(
      { spaces: report.spaces, changes: report.changes.filter((c) => c.action !== 'unchanged') },
      'code resources reconciled',
    );
  }
}
