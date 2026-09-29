import type { Manablox } from '@manablox/core/node';
import type { Redis } from 'ioredis';
import { createRedis } from './redis.js';

/**
 * The process's two Redis connections: `command` for every command (cache entries and
 * tags, rate limits, locks, usage counters, control events, publishes) and one subscriber
 * that every channel listens on. The job queue keeps its own, as BullMQ wants.
 */
export interface RedisHub {
  readonly command: Redis;
  /** Listens on `channel`; returns the unsubscribe. */
  subscribe(channel: string, handler: (message: string) => void): () => void;
  /**
   * Called each time the subscriber connects again after a drop: announcements sent in
   * between were missed.
   */
  onReconnect(handler: () => void): () => void;
  /** Publishes on the command connection; never throws, failures are logged. */
  publish(channel: string, message: string): void;
}

const hubs = new WeakMap<Manablox, RedisHub>();

/** The instance's hub, made on first use; null without `REDIS_URL`. Closed with the instance. */
export function redisHub(manablox: Manablox): RedisHub | null {
  const { redisUrl } = manablox.config.cache;
  if (!redisUrl) return null;
  const known = hubs.get(manablox);
  if (known) return known;

  const log = manablox.logger;
  const command = createRedis(redisUrl, 'command');
  command.on('error', (error) => log.debug({ err: error }, 'redis command connection error'));

  const handlers = new Map<string, Set<(message: string) => void>>();
  const reconnects = new Set<() => void>();
  let subscriber: Redis | null = null;
  // A subscribed connection can run nothing else, so it is its own.
  const listener = (): Redis => {
    if (subscriber) return subscriber;
    const connection = createRedis(redisUrl, 'subscriber');
    connection.on('error', (error) => log.debug({ err: error }, 'redis subscriber error'));
    connection.on('message', (channel: string, message: string) => {
      for (const handler of handlers.get(channel) ?? []) {
        try {
          handler(message);
        } catch (error) {
          log.warn({ err: error, channel }, 'channel handler failed');
        }
      }
    });
    let connected = false;
    connection.on('ready', () => {
      // Channels are subscribed again by the client; what was sent meanwhile is lost.
      if (connected) for (const handler of reconnects) handler();
      connected = true;
    });
    subscriber = connection;
    return connection;
  };

  const hub: RedisHub = {
    command,
    subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        listener()
          .subscribe(channel)
          .catch((error: unknown) => log.warn({ err: error, channel }, 'redis subscribe failed'));
      }
      set.add(handler);
      return () => {
        const current = handlers.get(channel);
        if (!current?.delete(handler) || current.size > 0) return;
        handlers.delete(channel);
        subscriber?.unsubscribe(channel).catch(() => {});
      };
    },
    onReconnect(handler) {
      listener();
      reconnects.add(handler);
      return () => reconnects.delete(handler);
    },
    publish(channel, message) {
      command.publish(channel, message).catch((error: unknown) => {
        log.warn({ err: error, channel }, 'redis publish failed');
      });
    },
  };
  hubs.set(manablox, hub);

  manablox.onDispose(async () => {
    hubs.delete(manablox);
    subscriber?.disconnect();
    // A failed graceful quit falls back to dropping the connection.
    await command.quit().catch(() => command.disconnect());
  });
  return hub;
}
