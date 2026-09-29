import { attachInvalidation, createCache, redisHub } from '@manablox/cache';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { registerLimitCounters } from './counters.js';
import { ControlEvents, usageTransitionEvents } from './events.js';
import { PromoteLocks } from './promote-lock.js';
import { CONTROLS_TTL_SECONDS, ControlStore } from './store.js';
import { attachUsageMetering, UsageMeter } from './usage.js';
import { UsageStateStore } from './usage-state.js';

export * from './api.js';
export * from './counters.js';
export * from './delivery.js';
export * from './events.js';
export * from './promote-lock.js';
export * from './service.js';
export * from './store.js';
export * from './usage.js';
export * from './usage-report.js';
export * from './usage-snapshot.js';
export * from './usage-state.js';

/**
 * Installs the database-backed controls on `manablox`: cached in process and in Redis when
 * one is configured, and dropped in every process sharing it when a write purges them.
 * Control values are configuration, not content, so `cache.enabled: false` keeps both. Usage is metered from the start; the last counts are
 * handed on before the instance stops. Usage levels are evaluated by `store.usageState`.
 */
export function installControls(manablox: Manablox, repos: Repositories): ControlStore {
  const { redisUrl } = manablox.config.cache;
  // Every Redis user shares the process's command connection.
  const redis = redisHub(manablox)?.command ?? null;
  const shared =
    redis && redisUrl
      ? createCache({ enabled: true, redisUrl, ttl: CONTROLS_TTL_SECONDS }, { redis })
      : null;
  if (shared) manablox.onDispose(() => shared.close());
  const store = new ControlStore(manablox, repos, { shared });
  store.connect(
    attachInvalidation(manablox, 'controls', (key) => store.forget(key ? key.split(' ') : null)),
  );
  registerLimitCounters(store, repos, manablox);
  manablox.setControls(store);

  store.promotes = new PromoteLocks(repos, {
    redis,
    announce: (spaceId) => store.announcePromote(spaceId),
    onError: (error) => manablox.logger.warn({ err: error }, 'promote marker unavailable'),
  });

  const events = new ControlEvents(manablox, repos, { redis, sharedRedis: true });
  manablox.onDispose(() => events.close());
  store.events = events;

  const anchorDay = async () => (await store.resolved(null)).usage.periodAnchorDay;
  const meter = new UsageMeter(manablox, repos, { redis, sharedRedis: true, anchorDay });
  // Management processes keep the transition baseline.
  store.usageState = new UsageStateStore(manablox, repos, {
    redis,
    anchorDay,
    owner: manablox.config.server.mode === 'management',
  });
  store.usageState.onTransition(usageTransitionEvents(events));
  store.usage = meter;
  attachUsageMetering(manablox);
  meter.start();
  manablox.hooks.on('before:stop', () => meter.close(), { source: 'controls' });
  return store;
}
