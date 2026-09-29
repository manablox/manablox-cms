// All env and config/targets.json settings. `open()` only works in the init context.

const targetsPath = __ENV.TARGETS_FILE || '../config/targets.json';

function loadTargets() {
  try {
    return JSON.parse(open(targetsPath));
  } catch (error) {
    console.warn(`targets file ${targetsPath} not readable (${error}); using built-in defaults`);
    return {};
  }
}

function number(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(name) {
  return (__ENV[name] || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stripSlash(url) {
  return url.replace(/\/+$/, '');
}

const targets = loadTargets();

export const config = {
  profile: __ENV.PROFILE || 'load',
  vuScale: number('VU_SCALE', 1),
  locale: __ENV.LOCALE || '',
  failOnRateLimit: bool('FAIL_ON_RATE_LIMIT', false),

  publicApi: {
    url: stripSlash(__ENV.PUBLIC_API_URL || 'http://host.docker.internal:3001'),
    p95: number('API_P95_MS', 500),
    p99: number('API_P99_MS', 1500),
    ...(targets.publicApi || {}),
  },

  frontends: {
    urls: list('FRONTEND_URLS').map(stripSlash),
    entries: targets.frontends || [],
    defaultPaths: targets.defaultFrontendPaths || ['/'],
    p95: number('FRONTEND_P95_MS', 2000),
    p99: number('FRONTEND_P99_MS', 5000),
  },

  maxErrorRate: number('MAX_ERROR_RATE', 0.01),

  // Control settings for the run; see controls.js.
  controls: {
    enabled: bool('CONTROLS', false),
    url: stripSlash(__ENV.CONTROL_API_URL || ''),
    key: __ENV.CONTROL_API_KEY || '',
    scope: __ENV.CONTROLS_SCOPE || 'instance',
    settleSeconds: number('CONTROLS_SETTLE_SECONDS', 6),
    settings: targets.controls?.settings,
  },

  // Requests per second, ramped from start to max. See profiles.js.
  breakpoint: {
    startRate: number('BREAKPOINT_START_RPS', 50),
    maxRate: number('BREAKPOINT_MAX_RPS', 5000),
    ramp: __ENV.BREAKPOINT_RAMP || '10m',
    maxVus: number('BREAKPOINT_MAX_VUS', 1000),
    abortDelay: __ENV.BREAKPOINT_ABORT_DELAY || '20s',
  },
};

export const isBreakpoint = config.profile === 'breakpoint';

/** FRONTEND_URLS merged with matching `targets.json` entries; the file alone when unset. */
export function resolveFrontends() {
  const byUrl = new Map(config.frontends.entries.map((entry) => [stripSlash(entry.url), entry]));
  const seen = new Set();
  const out = [];

  const push = (url, entry) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      name: entry?.name || url.replace(/^https?:\/\//, ''),
      url,
      // Host header override, e.g. for Vite's host check.
      host: entry?.host,
      paths: entry?.paths?.length ? entry.paths : config.frontends.defaultPaths,
      weight: Math.max(1, entry?.weight || 1),
    });
  };

  for (const url of config.frontends.urls) push(url, byUrl.get(url));
  if (config.frontends.urls.length === 0) {
    for (const [url, entry] of byUrl) push(url, entry);
  }
  return out;
}
