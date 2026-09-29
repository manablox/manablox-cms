import { check } from 'k6';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { config, isBreakpoint } from './config.js';

const rateLimited = new Counter('rate_limited');
const checkFailures = new Rate('check_failures');

// 429s from the rate limiter are counted separately, not as http_req_failed.
if (!config.failOnRateLimit) {
  http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));
}

export function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export function weightedPick(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

export function withQuery(path, params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `${path}?${pairs.join('&')}` : path;
}

/** Checks the status (429 counted as rate limited) and records `check_failures`. */
export function expectStatus(res, name, expected = 200) {
  if (res.status === 429) {
    rateLimited.add(1);
    return false;
  }
  const ok = check(res, {
    [`${name}: status ${expected}`]: (r) => r.status === expected,
  });
  checkFailures.add(!ok);
  return ok;
}

export function expectJson(res, name, predicate) {
  if (res.status === 429) {
    rateLimited.add(1);
    return null;
  }
  let body = null;
  const ok = check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: json body`]: (r) => {
      try {
        body = r.json();
        return predicate ? predicate(body) : body !== null;
      } catch {
        return false;
      }
    },
  });
  checkFailures.add(!ok);
  return ok ? body : null;
}

export function thinkTime() {
  // 0.5-2s pause between pages; none under breakpoint, where arrival rate paces.
  if (isBreakpoint) return 0;
  return 0.5 + Math.random() * 1.5;
}
