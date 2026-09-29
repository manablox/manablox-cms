// Load shapes: ramping-vus stages scaled by VU_SCALE; `breakpoint` ramps arrival rate instead.

import { config } from './config.js';

const PROFILES = {
  // One user, 30s. Run first against any new target.
  smoke: {
    stages: [{ duration: '30s', target: 1 }],
    gracefulStop: '5s',
  },
  // Expected traffic, held long enough for a meaningful p95.
  load: {
    stages: [
      { duration: '1m', target: 20 },
      { duration: '3m', target: 20 },
      { duration: '30s', target: 0 },
    ],
  },
  // Step up until something breaks.
  stress: {
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 50 },
      { duration: '2m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '1m', target: 0 },
    ],
  },
  // Sudden burst on a warm system; checks recovery.
  spike: {
    stages: [
      { duration: '30s', target: 5 },
      { duration: '10s', target: 200 },
      { duration: '1m', target: 200 },
      { duration: '10s', target: 5 },
      { duration: '1m', target: 5 },
    ],
  },
  // Long moderate load: leaks, pool exhaustion, log growth.
  soak: {
    stages: [
      { duration: '2m', target: 30 },
      { duration: '30m', target: 30 },
      { duration: '1m', target: 0 },
    ],
  },
};

export function parseDuration(text) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(text).trim());
  if (!match) throw new Error(`bad duration "${text}"; use 30s, 10m, 1h`);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * unit;
}

/** Capacity probe: ramps arrival rate from `startRate` to `maxRate` until a threshold aborts. */
function breakpointScenario(exec, share, extra = {}) {
  const bp = config.breakpoint;
  return {
    executor: 'ramping-arrival-rate',
    exec,
    timeUnit: '1s',
    startRate: Math.max(1, Math.round(bp.startRate * share)),
    stages: [{ duration: bp.ramp, target: Math.max(1, Math.round(bp.maxRate * share)) }],
    // All up front: spinning VUs up mid-run drops iterations.
    preAllocatedVUs: Math.max(1, Math.round(bp.maxVus * share)),
    maxVUs: Math.max(1, Math.round(bp.maxVus * share)),
    gracefulStop: '5s',
    ...extra,
  };
}

/** Under `breakpoint`, thresholds abort the run after `abortDelay`. */
export function hardened(thresholds) {
  if (config.profile !== 'breakpoint') return thresholds;
  const out = {};
  for (const [metric, list] of Object.entries(thresholds)) {
    out[metric] = list.map((threshold) => ({
      threshold,
      abortOnFail: true,
      delayAbortEval: config.breakpoint.abortDelay,
    }));
  }
  // Dropped iterations: the server cannot keep up, or BREAKPOINT_MAX_VUS is too low.
  out.dropped_iterations = [
    { threshold: 'count<100', abortOnFail: true, delayAbortEval: config.breakpoint.abortDelay },
  ];
  return out;
}

function stagesFor(profile, scale = 1) {
  const definition = PROFILES[profile];
  if (!definition) {
    throw new Error(
      `unknown PROFILE "${profile}"; one of ${Object.keys(PROFILES).join(', ')}, breakpoint`,
    );
  }
  return definition.stages.map((stage) => ({
    duration: stage.duration,
    target: Math.max(stage.target === 0 ? 0 : 1, Math.round(stage.target * scale)),
  }));
}

/** A scenario for `exec` under `profile`; `scale` is its share of the total. */
export function scenario(exec, profile, scale, extra = {}) {
  if (profile === 'breakpoint') return breakpointScenario(exec, scale, extra);
  const definition = PROFILES[profile] || {};
  const stages = stagesFor(profile, scale);
  return {
    executor: 'ramping-vus',
    exec,
    startVUs: profile === 'smoke' ? stages[0].target : 0,
    stages,
    gracefulRampDown: '10s',
    gracefulStop: definition.gracefulStop || '30s',
    ...extra,
  };
}
