import { randomUUID } from 'node:crypto';
import type { ContentTypeDefinition } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { redisHub } from './hub.js';
import { REDIS_PREFIX } from './redis.js';

/** Where the process that changed the content types announces it. */
export const REGISTRY_CHANNEL = `${REDIS_PREFIX}registry`;

export interface RegistrySyncSource {
  /** Every runtime content type. */
  load(): Promise<ContentTypeDefinition[]>;
  /** One space's runtime types in every environment; the global ones for `null`. */
  loadSpace?(spaceId: string | null): Promise<ContentTypeDefinition[]>;
  /** Changes whenever a runtime content type is created, edited or deleted. */
  fingerprint(): Promise<string>;
}

/** What an announcement reloads: every type, or one space's (`-` for the global ones). */
const EVERYTHING = '*';
const GLOBAL = '-';

/**
 * Keeps the content-type registry of every process on one database in step, the public
 * API among them. With Redis a reload is announced with the space it concerns and the
 * others reload that space at once; without it each process checks the database every
 * `cache.syncInterval` seconds and reloads everything.
 */
export async function attachRegistrySync(
  manablox: Manablox,
  source: RegistrySyncSource,
): Promise<void> {
  const reload = serialised(async (scopes) => {
    try {
      if (scopes.has(EVERYTHING) || !source.loadSpace) {
        await manablox.reload(await source.load(), { synced: true });
      } else {
        for (const scope of scopes) {
          const spaceId = scope === GLOBAL ? null : scope;
          await manablox.reloadSpace(spaceId, await source.loadSpace(spaceId), { synced: true });
        }
      }
      manablox.logger.info(
        { schemaVersion: manablox.contentTypes.schemaVersion, scopes: [...scopes] },
        'content types synced',
      );
    } catch (error) {
      manablox.logger.warn({ err: error }, 'content type sync failed');
    }
  });

  const { redisUrl, syncInterval } = manablox.config.cache;
  if (redisUrl) announce(manablox, reload);
  else if (syncInterval > 0) await poll(manablox, source, syncInterval, reload);
}

function announce(manablox: Manablox, reload: (scope: string) => Promise<void>): void {
  const hub = redisHub(manablox);
  if (!hub) return;
  const instance = randomUUID();
  const unsubscribe = hub.subscribe(REGISTRY_CHANNEL, (message) => {
    const [sender, scope = EVERYTHING] = message.split(' ');
    if (sender !== instance) void reload(scope);
  });
  // Announcements sent while disconnected are lost, so a reconnect catches up.
  const unwatch = hub.onReconnect(() => void reload(EVERYTHING));

  manablox.hooks.on(
    'registry:afterReload',
    ({ synced, spaceId }) => {
      if (synced) return;
      const scope = spaceId === undefined ? EVERYTHING : (spaceId ?? GLOBAL);
      // Not awaited: an unreachable Redis must not hold up the save that reloaded.
      hub.publish(REGISTRY_CHANNEL, `${instance} ${scope}`);
    },
    { source: '@manablox/cache' },
  );

  manablox.onDispose(() => {
    unsubscribe();
    unwatch();
  });
}

async function poll(
  manablox: Manablox,
  source: RegistrySyncSource,
  seconds: number,
  reload: (scope: string) => Promise<void>,
): Promise<void> {
  let last = await source.fingerprint();
  let checking = false;

  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const next = await source.fingerprint();
      if (next !== last) {
        last = next;
        await reload(EVERYTHING);
      }
    } catch (error) {
      manablox.logger.warn({ err: error }, 'content type check failed');
    } finally {
      checking = false;
    }
  }, seconds * 1000);
  timer.unref();

  manablox.onDispose(() => clearInterval(timer));
}

/**
 * One run at a time; calls during a run fold into a single run after it, with every scope
 * they asked for.
 */
function serialised(run: (scopes: Set<string>) => Promise<void>): (scope: string) => Promise<void> {
  let current: Promise<void> | null = null;
  let pending = new Set<string>();

  return (scope) => {
    pending.add(scope);
    if (current) return current;
    current = (async () => {
      while (pending.size > 0) {
        const scopes = pending;
        pending = new Set();
        await run(scopes);
      }
    })().finally(() => {
      current = null;
    });
    return current;
  };
}
