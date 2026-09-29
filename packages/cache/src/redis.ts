import { Redis } from 'ioredis';

/** Prefix of every key and channel Manablox writes to Redis. */
export const REDIS_PREFIX = 'manablox:';

/** What a connection is for; names it in `CLIENT LIST` and sets its retry policy. */
export type RedisRole =
  /** The process's shared command connection, see `redisHub`. */
  | 'command'
  /** The process's shared subscriber. */
  | 'subscriber'
  /** BullMQ's own. */
  | 'jobs'
  /** Stand-alone clients made from a URL, e.g. in tests. */
  | 'cache'
  | 'rateLimit'
  | 'lock';

/** A named Redis connection. Keys are not auto-prefixed; callers prepend `REDIS_PREFIX`. */
export function createRedis(url: string, role: RedisRole): Redis {
  return new Redis(url, {
    connectionName: `${REDIS_PREFIX}${role}`,
    // BullMQ requires unlimited retries; a subscriber runs no commands to retry.
    maxRetriesPerRequest: role === 'jobs' || role === 'subscriber' ? null : 2,
  });
}
