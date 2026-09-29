import { createHash, randomUUID } from 'node:crypto';
import type { RateLimitStore } from '@manablox/core';
import { createRedis, REDIS_PREFIX } from './redis.js';

export {
  type BackoffPolicy,
  backoffFor,
  type MemoryRateLimitStore,
  memoryRateLimitStore,
  type RateLimitStore,
} from '@manablox/core';

/** The subset of a Redis client the store needs, so tests can substitute one. */
export interface RateLimitRedisClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  evalsha(sha: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

interface Script {
  source: string;
  sha: string;
}

const script = (source: string): Script => ({
  source,
  sha: createHash('sha1').update(source).digest('hex'),
});

const isNoScript = (error: unknown) =>
  error instanceof Error && error.message.startsWith('NOSCRIPT');

/**
 * The sliding window of `slide` in one script. ARGV holds `max` and `window` per key; nothing
 * is counted when any check refuses. Returns allowed, index (1-based), limit, remaining, reset.
 */
const CONSUME_SCRIPT = script(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local states = {}
for i = 1, #KEYS do
  local max = tonumber(ARGV[2 * i - 1])
  local window = tonumber(ARGV[2 * i])
  local index = math.floor(now / window)
  local held = redis.call('HMGET', KEYS[i], 'i', 'c', 'p')
  local stored = tonumber(held[1])
  local current = 0
  local previous = 0
  if stored == index then
    current = tonumber(held[2]) or 0
    previous = tonumber(held[3]) or 0
  elseif stored == index - 1 then
    previous = tonumber(held[2]) or 0
  end
  local elapsed = now - index * window
  local used = previous * (window - elapsed) / window + current
  if used + 1 > max then
    local wait
    if max <= 0 then
      wait = window - elapsed
    elseif current <= max - 1 then
      wait = window - (max - 1 - current) * window / previous - elapsed
    else
      wait = window - elapsed + window - (max - 1) * window / current
    end
    return { 0, i, max, 0, math.max(1, math.ceil(wait)) }
  end
  states[i] = { index, current, previous, used, elapsed, window, max }
end
local best = 1
local bestRemaining = nil
for i = 1, #KEYS do
  local s = states[i]
  redis.call('HSET', KEYS[i], 'i', s[1], 'c', s[2] + 1, 'p', s[3])
  redis.call('PEXPIRE', KEYS[i], s[6] * 2)
  local remaining = math.max(0, math.floor(s[7] - s[4] - 1))
  if bestRemaining == nil or remaining < bestRemaining then
    best = i
    bestRemaining = remaining
  end
end
local s = states[best]
return { 1, best, s[7], bestRemaining, s[6] - s[5] }
`);

/** Drops expired holders, then takes a slot unless `max` are held. */
const ACQUIRE_SCRIPT = script(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`);

const BLOCKED_SCRIPT = script(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local longest = 0
for i = 1, #KEYS do
  local untilAt = tonumber(redis.call('HGET', KEYS[i], 'u'))
  if untilAt and untilAt - now > longest then longest = untilAt - now end
end
return longest
`);

/** `backoffFor` per key; ARGV: attempts, window, maxDelay. */
const FAIL_SCRIPT = script(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local attempts = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maxDelay = tonumber(ARGV[3])
for i = 1, #KEYS do
  local failures = redis.call('HINCRBY', KEYS[i], 'f', 1)
  local delay = 0
  if failures > attempts then delay = math.min(maxDelay, 1000 * 2 ^ (failures - attempts - 1)) end
  redis.call('HSET', KEYS[i], 'u', now + delay)
  redis.call('PEXPIRE', KEYS[i], math.max(window, delay))
end
return 1
`);

const RELEASE_SCRIPT = script("return redis.call('ZREM', KEYS[1], ARGV[1])");
const CLEAR_SCRIPT = script("return redis.call('DEL', unpack(KEYS))");

/** Counters shared by every replica through Redis, one round trip per call once cached. */
export function redisRateLimitStore(
  target: string | RateLimitRedisClient,
  options: { prefix?: string } = {},
): RateLimitStore {
  const redis: RateLimitRedisClient =
    typeof target === 'string' ? createRedis(target, 'rateLimit') : target;
  const prefix = options.prefix ?? `${REDIS_PREFIX}rl:`;
  const slotKey = (key: string) => `${prefix}slot:${key}`;
  const backoffKey = (key: string) => `${prefix}bo:${key}`;
  // EVALSHA, with EVAL (which caches the script) once Redis does not know it.
  const run = async (entry: Script, keys: string[], ...args: (string | number)[]) => {
    try {
      return await redis.evalsha(entry.sha, keys.length, ...keys, ...args);
    } catch (error) {
      if (!isNoScript(error)) throw error;
      return redis.eval(entry.source, keys.length, ...keys, ...args);
    }
  };

  return {
    async consume(checks) {
      if (checks.length === 0) return { allowed: true, index: 0, limit: 0, remaining: 0, reset: 0 };
      const [allowed, index, limit, remaining, reset] = (await run(
        CONSUME_SCRIPT,
        checks.map((check) => `${prefix}${check.key}`),
        ...checks.flatMap((check) => [check.max, check.window]),
      )) as number[];
      return {
        allowed: allowed === 1,
        index: Number(index) - 1,
        limit: Number(limit),
        remaining: Number(remaining),
        reset: Number(reset),
      };
    },
    async acquire(key, max, ttl) {
      const token = randomUUID();
      const taken = await run(ACQUIRE_SCRIPT, [slotKey(key)], max, ttl, token);
      return Number(taken) === 1 ? token : null;
    },
    async release(key, token) {
      await run(RELEASE_SCRIPT, [slotKey(key)], token);
    },
    async blocked(keys) {
      if (keys.length === 0) return 0;
      return Number(await run(BLOCKED_SCRIPT, keys.map(backoffKey)));
    },
    async fail(keys, policy) {
      if (keys.length === 0) return;
      await run(FAIL_SCRIPT, keys.map(backoffKey), policy.attempts, policy.window, policy.maxDelay);
    },
    async clear(keys) {
      if (keys.length === 0) return;
      await run(CLEAR_SCRIPT, keys.map(backoffKey));
    },
    async close() {
      // A connection passed in belongs to the caller.
      if (typeof target === 'string') await redis.quit();
    },
  };
}
