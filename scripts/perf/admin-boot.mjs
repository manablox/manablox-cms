#!/usr/bin/env node
// `pnpm perf admin [label]`: the prebuilt admin's first load, served by the API with the four
// feature plugins' bundles, in headless Chromium. Per case and network profile it runs
// PERF_ADMIN_RUNS (5) cold loads, each in a fresh browser context, and prints medians of:
//
//   wire KB    bytes transferred (the navigation and every resource, headers included)
//   raw KB     the same bodies decoded, what an uncompressed server sends
//   requests   requests the load made
//   FCP, LCP   first and largest contentful paint (ms from navigation start)
//   ready      the case's own milestone: the login form, or the plugin page's heading
//
// Cases: `login` (signed out, `/login`), `plugin` (signed in, a deep link to the workflows
// plugin's list, so the time runs until plugin routes are installed and the page renders),
// `plugin-warm` (the same deep link again in the same context, assets cached). Profiles:
// `local` (no throttling) and `4g` (40 ms latency, 10 Mbit/s down, 5 up, via CDP).
//
// It boots `apps/api/scripts/serve-admin-perf.mts` on PERF_ADMIN_PORT (3390) without Redis,
// against DATABASE_URL, which `scripts/perf.sh admin` points at a throwaway database
// (PERF_ADMIN_DATABASE, manablox_perf_admin) it creates before and drops after. Build first
// (or pass `--build`):
//
//   NODE_ENV=production pnpm --filter @manablox/admin build
//   pnpm --filter '@manablox/plugin-*' build:admin
//
// Writes JSON to PERF_OUT (loadtest/results). Uses `apps/admin`'s Playwright and its Chromium.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
/** The checkout whose admin and server are measured: PERF_ADMIN_TREE for an A/B against another
 * commit's checkout (built, with this `serve-admin-perf.mts` copied in), else this one. */
const TREE = env.PERF_ADMIN_TREE ?? ROOT;
const args = process.argv.slice(2);
const label = args.find((arg) => !arg.startsWith('--')) ?? 'admin';
const RUNS = Number(env.PERF_ADMIN_RUNS ?? 5);
const PORT = Number(env.PERF_ADMIN_PORT ?? 3390);
const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error('DATABASE_URL names the throwaway database; run it through perf.sh');
const OUT_DIR = env.PERF_OUT ?? join(ROOT, 'loadtest/results');
const BASE = `http://localhost:${PORT}`;
const ACCOUNT = { email: 'perf@manablox.test', password: 'perf-password-123' };
const PROFILES = {
  local: null,
  '4g': { latency: 40, downloadThroughput: (10e6 / 8) | 0, uploadThroughput: (5e6 / 8) | 0 },
};

const { chromium } = createRequire(join(ROOT, 'apps/admin/package.json'))('@playwright/test');

function build() {
  const run = (argv, extra = {}) =>
    execFileSync('pnpm', argv, { cwd: TREE, stdio: 'inherit', env: { ...env, ...extra } });
  run(['--filter', '@manablox/admin', 'build'], { NODE_ENV: 'production' });
  run(['--filter', '@manablox/plugin-*', 'build:admin'], { NODE_ENV: 'production' });
}

async function bootServer(scratch) {
  const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve-admin-perf.mts'], {
    cwd: join(TREE, 'apps/api'),
    env: {
      ...env,
      DATABASE_URL,
      REDIS_URL: '',
      AUTH_SECRET: 'perf-auth-secret-0123456789abcdef0123456789',
      PORT: String(PORT),
      PUBLIC_URL: BASE,
      NODE_ENV: 'production',
      LOG_LEVEL: env.LOG_LEVEL ?? 'warn',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_PATH: join(scratch, 'uploads'),
      MEDIA_CACHE_PATH: join(scratch, 'media-cache'),
      MAIL_DRIVER: 'none',
      RATE_LIMIT: 'off',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise((_, reject) =>
    server.once('exit', (code) => reject(new Error(`server exited with ${code}`))),
  );
  exited.catch(() => {});
  for (let attempt = 0; attempt < 600; attempt++) {
    const ready = await fetch(`${BASE}/readyz`).then(
      (res) => res.status === 200,
      () => false,
    );
    if (ready) return server;
    await Promise.race([new Promise((resolve) => setTimeout(resolve, 100)), exited]);
  }
  throw new Error('server did not come up');
}

/** Records paint, LCP, mount and the milestone element's first appearance. */
function probe(milestone) {
  const marks = {};
  window.__perf = marks;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) marks.lcp = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  const check = () => {
    if (marks.mounted === undefined && document.getElementById('app')?.firstElementChild) {
      marks.mounted = performance.now();
    }
    if (marks.ready !== undefined) return;
    const found =
      milestone.kind === 'selector'
        ? document.querySelector(milestone.value)
        : [...document.querySelectorAll('h1')].find(
            (heading) => heading.textContent?.trim() === milestone.value,
          );
    if (found) marks.ready = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
}

function collect() {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  const all = [nav, ...resources].filter(Boolean);
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  return {
    wire: all.reduce((sum, entry) => sum + entry.transferSize, 0),
    raw: all.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    requests: all.length,
    fcp,
    lcp: window.__perf.lcp ?? null,
    mounted: window.__perf.mounted ?? null,
    ready: window.__perf.ready ?? null,
  };
}

const CASES = {
  login: {
    path: '/login',
    signedIn: false,
    milestone: { kind: 'selector', value: 'input[type=email]' },
  },
  plugin: {
    path: '/workflows',
    signedIn: true,
    milestone: { kind: 'heading', value: 'Workflows' },
  },
};

async function load(context, page, profile, path) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // Each run starts cold unless it reuses the context on purpose.
  if (profile) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__perf?.ready !== undefined, null, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
  const result = await page.evaluate(collect);
  await cdp.detach();
  return result;
}

async function measure(browser, storageState) {
  const rows = [];
  for (const [profileName, profile] of Object.entries(PROFILES)) {
    for (const [caseName, spec] of Object.entries(CASES)) {
      const cold = [];
      const warm = [];
      for (let run = 0; run < RUNS; run++) {
        const context = await browser.newContext({
          viewport: { width: 1600, height: 1000 },
          ...(spec.signedIn ? { storageState } : {}),
        });
        await context.addInitScript(probe, spec.milestone);
        const page = await context.newPage();
        cold.push(await load(context, page, profile, spec.path));
        if (spec.signedIn) {
          const again = await context.newPage();
          warm.push(await load(context, again, profile, spec.path));
        }
        await context.close();
      }
      rows.push({ profile: profileName, case: caseName, runs: cold, median: medians(cold) });
      if (warm.length) {
        rows.push({
          profile: profileName,
          case: `${caseName}-warm`,
          runs: warm,
          median: medians(warm),
        });
      }
    }
  }
  return rows;
}

function medians(runs) {
  const median = (values) => {
    const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return Object.fromEntries(
    Object.keys(runs[0]).map((key) => [key, median(runs.map((run) => run[key]))]),
  );
}

async function signIn(browser) {
  const context = await browser.newContext();
  const res = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    data: ACCOUNT,
    headers: { origin: BASE },
  });
  if (!res.ok()) throw new Error(`sign-in answered ${res.status()}: ${await res.text()}`);
  const state = await context.storageState();
  await context.close();
  return state;
}

function print(rows) {
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const ms = (value) => (value === null ? '-' : String(Math.round(value)));
  console.log(`\nadmin boot (${label}), medians of ${RUNS}`);
  console.log('profile  case         wire KB   raw KB  req   FCP   LCP  mount  ready');
  for (const { profile, case: name, median: m } of rows) {
    console.log(
      `${profile.padEnd(8)} ${name.padEnd(12)} ${kb(m.wire).padStart(7)} ${kb(m.raw).padStart(8)} ${String(m.requests).padStart(4)} ${ms(m.fcp).padStart(5)} ${ms(m.lcp).padStart(5)} ${ms(m.mounted).padStart(6)} ${ms(m.ready).padStart(6)}`,
    );
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'manablox-perf-admin-'));
let server;
let browser;
const cleanup = () => {
  server?.kill('SIGTERM');
  rmSync(scratch, { recursive: true, force: true });
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

try {
  if (args.includes('--build')) build();
  server = await bootServer(scratch);
  browser = await chromium.launch();
  const storageState = await signIn(browser);
  const rows = await measure(browser, storageState);
  print(rows);
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const file = join(OUT_DIR, `admin-${label}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ label, runs: RUNS, rows }, null, 2)}\n`);
  console.log(`\nwritten ${file}`);
} finally {
  await browser?.close();
  cleanup();
}
