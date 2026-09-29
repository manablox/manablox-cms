// The cases `scripts/perf.sh run` measures against the processes it booted, in two passes.
// `PERF_PASS=probe` (processes in development) reads the database statements of a warm
// request from `x-manablox-db-queries` and writes them to `PERF_PROBES`. The measuring pass
// (production) takes throughput and latency (autocannon) and the Redis commands per request
// (`INFO commandstats` delta, less the idle processes' own traffic), and merges the probes.
// Management cases time single RPC calls through a signed-in session.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Agent, request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { commandStats, redis } from './redis.mjs';

const env = process.env;
const seed = JSON.parse(readFileSync(env.PERF_SEED, 'utf8'));
const MGMT = env.PERF_MGMT;
const PUBLIC = env.PERF_PUBLIC;
const SECONDS = Number(env.PERF_SECONDS ?? 8);
const CONNECTIONS = Number(env.PERF_CONNECTIONS ?? 20);
/** Lets fire-and-forget work of the last requests (usage counters) land. */
const SETTLE_MS = 2000;
const API_HOST = 'api.perf.test';

const PROBE = env.PERF_PASS === 'probe';
const probes = PROBE ? {} : JSON.parse(readFileSync(env.PERF_PROBES, 'utf8'));
const client = redis(env.PERF_REDIS);
const results = {
  label: env.PERF_LABEL,
  at: new Date().toISOString(),
  boot: {},
  http: [],
  manage: [],
};

async function counters() {
  const stats = await commandStats(client);
  // `info` itself and the SELECT of this client are ours.
  const redisTotal = Object.entries(stats)
    .filter(([name]) => name !== 'info' && name !== 'select')
    .reduce((sum, [, calls]) => sum + calls, 0);
  return { stats, redisTotal, at: Date.now() };
}

function delta(before, after) {
  const commands = {};
  for (const [name, calls] of Object.entries(after.stats)) {
    const diff = calls - (before.stats[name] ?? 0);
    if (diff > 0 && name !== 'info' && name !== 'select') commands[name] = diff;
  }
  return {
    redis: after.redisTotal - before.redisTotal,
    ms: after.at - before.at,
    commands,
  };
}

/** What the idle processes do on their own, per millisecond. */
let noise = { redis: 0, commands: {} };
async function measureNoise() {
  const before = await counters();
  await sleep(SETTLE_MS * 5);
  const idle = delta(before, await counters());
  noise = {
    redis: idle.redis / idle.ms,
    commands: Object.fromEntries(Object.entries(idle.commands).map(([k, v]) => [k, v / idle.ms])),
  };
}

function autocannon(url, { method = 'GET', headers = {}, body } = {}) {
  // A fixed duration: with `-a` autocannon ends on its next one-second tick.
  const args = ['dlx', 'autocannon', '--json', '-c', String(CONNECTIONS), '-d', String(SECONDS)];
  args.push('-m', method);
  for (const [name, value] of Object.entries(headers)) args.push('-H', `${name}=${value}`);
  if (body) args.push('-b', body);
  args.push(url);
  const run = spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const line = run.stdout.split('\n').find((each) => each.startsWith('{'));
  if (!line) throw new Error(`autocannon failed: ${run.stderr}`);
  return JSON.parse(line);
}

/** One request with the headers as given (fetch drops `Host`). */
function send(url, { method = 'GET', headers = {}, body, agent } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, ...(agent ? { agent } : {}) }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString(),
        }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Statements of a warm request, from the development pass. */
const queriesOf = (headers) => {
  const value = headers['x-manablox-db-queries'];
  return value === undefined ? null : Number(value);
};

async function httpCase(name, url, options = {}) {
  const probe = await send(url, options);
  if (probe.status !== 200) throw new Error(`${name}: ${probe.status} ${probe.text.slice(0, 300)}`);
  // A second probe, so the measured run starts from a warm cache.
  const warm = await send(url, options);
  if (PROBE) {
    probes[name] = queriesOf(warm.headers);
    console.log(`${name.padEnd(22)} db ${probes[name]}/req (warm)`);
    return;
  }
  const before = await counters();
  const run = autocannon(url, options);
  await sleep(SETTLE_MS);
  const change = delta(before, await counters());
  const requests = run.requests.total;
  const perRequest = (value, rate) => Math.max(0, (value - rate * change.ms) / requests);
  const commands = Object.fromEntries(
    Object.entries(change.commands)
      .map(([command, calls]) => [command, perRequest(calls, noise.commands[command] ?? 0)])
      .filter(([, value]) => value >= 0.01)
      .map(([command, value]) => [command, Number(value.toFixed(2))]),
  );
  const row = {
    name,
    requests,
    rps: Math.round(requests / run.duration),
    p50: run.latency.p50,
    p99: run.latency.p99,
    non2xx: run.non2xx,
    errors: run.errors,
    contentLength: probe.headers['content-length'] ?? null,
    redisPerRequest: Number(perRequest(change.redis, noise.redis).toFixed(2)),
    dbPerRequest: probes[name] ?? null,
    commands,
  };
  results.http.push(row);
  console.log(
    `${name.padEnd(22)} ${String(row.rps).padStart(6)} req/s  p50 ${row.p50} ms  p99 ${row.p99} ms  redis ${row.redisPerRequest}/req  db ${row.dbPerRequest}/req  ${JSON.stringify(commands)}${row.non2xx ? `  non2xx ${row.non2xx}` : ''}`,
  );
}

// --- Management ---------------------------------------------------------------

let cookie = '';
async function signIn() {
  const response = await fetch(`${MGMT}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: MGMT },
    body: JSON.stringify({ email: 'perf@manablox.test', password: 'perf-password-123' }),
  });
  if (!response.ok) throw new Error(`sign-in: ${response.status} ${await response.text()}`);
  cookie = response.headers
    .getSetCookie()
    .map((each) => each.split(';')[0])
    .join('; ');
}

async function rpc(path, input) {
  const started = performance.now();
  const response = await fetch(`${MGMT}/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: MGMT },
    body: JSON.stringify({ json: input }),
  });
  const text = await response.text();
  const ms = performance.now() - started;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  return {
    ms,
    bytes: Buffer.byteLength(text),
    queries: queriesOf(Object.fromEntries(response.headers)),
    json: JSON.parse(text).json,
  };
}

/** `input` may be a function, for calls that must differ each time. */
async function manageCase(name, path, input, times = 5) {
  const next = () => (typeof input === 'function' ? input() : input);
  if (PROBE) {
    const result = await rpc(path, next());
    probes[name] = result.queries;
    console.log(`${name.padEnd(28)} db ${result.queries}/call`);
    return;
  }
  const runs = [];
  let bytes = 0;
  for (let index = 0; index < times; index++) {
    const before = await counters();
    const result = await rpc(path, next());
    bytes = result.bytes;
    runs.push({ ms: result.ms, before });
  }
  await sleep(SETTLE_MS);
  const after = await counters();
  const change = delta(runs[0].before, after);
  const sorted = runs.map((run) => run.ms).sort((a, b) => a - b);
  const row = {
    name,
    runs: times,
    medianMs: Math.round(sorted[Math.floor(times / 2)]),
    minMs: Math.round(sorted[0]),
    bytes,
    dbPerCall: probes[name] ?? null,
    redisPerCall: Math.round(Math.max(0, change.redis - noise.redis * change.ms) / times),
  };
  results.manage.push(row);
  console.log(
    `${name.padEnd(28)} median ${row.medianMs} ms (min ${row.minMs})  ${row.bytes} bytes  db ${row.dbPerCall}/call  redis ${row.redisPerCall}/call`,
  );
}

// --- Run ------------------------------------------------------------------------

results.boot = {
  management: Number(env.BOOT_MGMT),
  public: Number(env.BOOT_PUBLIC),
};
console.log(`boot ms: ${JSON.stringify(results.boot)}`);

if (!PROBE) {
  // Connections the booted processes hold (all four share the Redis database), by name.
  const db = new URL(env.PERF_REDIS).pathname.slice(1) || '0';
  const clients = String(await client.command('CLIENT', 'LIST'))
    .split('\n')
    .filter((line) => line.includes(` db=${db} `) && !line.includes(' cmd=client|list'));
  const byName = {};
  for (const line of clients) {
    const name = /name=(\S*)/.exec(line)?.[1] || '(none)';
    byName[name] = (byName[name] ?? 0) + 1;
  }
  results.redisClients = { total: clients.length, perProcess: clients.length / 4, byName };
  console.log(`redis connections: ${clients.length} (4 processes) ${JSON.stringify(byName)}`);
  await measureNoise();
}
console.log(`idle noise per second: redis ${(noise.redis * 1000).toFixed(1)}`);

const only = env.PERF_CASES ? new Set(env.PERF_CASES.split(',')) : null;
const wanted = (group) => !only || only.has(group);

if (wanted('delivery')) {
  const api = { headers: { host: API_HOST } };
  await httpCase('rest list (cached)', `${PUBLIC}/v1/content?limit=25`, api);
  await httpCase('rest menu (cached)', `${PUBLIC}/v1/menus/main`, api);
  const gql = JSON.stringify({ query: '{ contentsPage(limit: 25) { items { id title } } }' });
  await httpCase('graphql list (cached)', `${PUBLIC}/graphql`, {
    method: 'POST',
    headers: { host: API_HOST, 'content-type': 'application/json' },
    body: gql,
  });
  const nocache = env.PERF_PUBLIC_NOCACHE;
  const uncached = api;
  await httpCase('rest list (uncached)', `${nocache}/v1/content?limit=25`, uncached);
  await httpCase('rest menu (uncached)', `${nocache}/v1/menus/main`, uncached);
  await httpCase('graphql list (uncached)', `${nocache}/graphql`, {
    method: 'POST',
    headers: { host: API_HOST, 'content-type': 'application/json' },
    body: gql,
  });
}
if (wanted('lists')) {
  // The 20k-document space: public lists, uncached.
  const tree = { headers: { host: 'api-tree.perf.test' } };
  const nocache = env.PERF_PUBLIC_NOCACHE;
  await httpCase('rest list 20k (uncached)', `${nocache}/v1/content?limit=25`, tree);
  await httpCase('rest list 20k by type', `${nocache}/v1/content?limit=25&type=page`, tree);
  await httpCase('rest list 20k page 400', `${nocache}/v1/content?limit=25&offset=10000`, tree);
}
if (wanted('manage')) {
  await signIn();
  await manageCase('session (user.me)', 'users/me', null);
  await manageCase('tree children (root)', 'content/treeChildren', {
    spaceId: seed.tree,
    locale: 'en',
    parentId: null,
    pagination: { limit: 50, offset: 0 },
  });
  if (seed.rootId) {
    await manageCase('tree children (level 2)', 'content/treeChildren', {
      spaceId: seed.tree,
      locale: 'en',
      parentId: seed.rootId,
      pagination: { limit: 50, offset: 0 },
    });
  }
  await manageCase('content list (20k)', 'content/list', {
    filter: { spaceId: seed.tree },
    pagination: { limit: 50, offset: 0 },
  });
  await manageCase('content list (20k) page 200', 'content/list', {
    filter: { spaceId: seed.tree },
    pagination: { limit: 50, offset: 10000 },
  });
  await manageCase('audit list (42k)', 'audit/list', {
    spaceId: seed.tree,
    pagination: { limit: 50, offset: 0 },
  });
  await manageCase('audit list page 400', 'audit/list', {
    spaceId: seed.tree,
    pagination: { limit: 50, offset: 20000 },
  });
  await manageCase('audit search', 'audit/list', {
    spaceId: seed.tree,
    filter: { search: 'Document 1999' },
    pagination: { limit: 50, offset: 0 },
  });
  if (seed.typedType) {
    // A save that changes the model rebuilds the registry (3,000 types).
    let round = 0;
    const type = await rpc('contentTypes/get', { spaceId: seed.typedSpace, id: seed.typedType });
    await manageCase('content type save (3k types)', 'contentTypes/update', () => ({
      ...type.json,
      spaceId: seed.typedSpace,
      description: `Round ${++round}`,
    }));
  }
  // A save in the space with 20 webhooks listening.
  const page = (
    await rpc('content/list', {
      filter: { spaceId: seed.site },
      pagination: { limit: 1, offset: 0 },
    })
  ).json.items[0];
  let edit = 0;
  await manageCase('content save (20 webhooks)', 'content/update', () => ({
    spaceId: seed.site,
    id: page.id,
    typeId: page.typeId,
    locale: page.locale,
    title: page.title,
    slug: page.slug,
    fields: { ...page.fields, summary: `Edit ${++edit}` },
  }));
  await manageCase('export (20k)', 'spaces/export', { spaceId: seed.tree }, 1);
  await manageCase(
    'copy full (20k)',
    'environments/create',
    { spaceId: seed.tree, machineName: 'copy', name: 'Copy', mode: 'full' },
    1,
  );
  await manageCase(
    'promote full (20k)',
    'environments/promote',
    {
      spaceId: seed.tree,
      environment: 'staging',
      mode: 'full',
      confirm: true,
    },
    1,
  );
}

if (wanted('tags') && !PROBE) {
  // Unique URLs on the three-second cache for 20 seconds: every answer is stored under the
  // space's tag. Then what a purge of that tag has to read, and what the tag costs in Redis.
  // Sorted sets under `tz:` since 6.7, plain sets under `t:` before.
  const zset = `manablox:tz:space:${seed.site}`;
  const size = async () => {
    const tag = (await client.command('EXISTS', zset)) ? zset : `manablox:t:space:${seed.site}`;
    const type = await client.command('TYPE', tag);
    const members =
      type === 'set'
        ? await client.command('SCARD', tag)
        : type === 'zset'
          ? await client.command('ZCARD', tag)
          : 0;
    const live =
      type === 'zset' ? await client.command('ZCOUNT', tag, String(Date.now()), '+inf') : members;
    const memory = type === 'none' ? 0 : await client.command('MEMORY', 'USAGE', tag);
    const started = performance.now();
    if (type === 'set') await client.command('SMEMBERS', tag);
    else if (type === 'zset')
      await client.command('ZRANGEBYSCORE', tag, String(Date.now()), '+inf');
    return {
      type,
      members,
      live,
      bytes: memory,
      readMs: Number((performance.now() - started).toFixed(2)),
    };
  };
  // autocannon repeats one URL, so a small loop of our own makes each one unique.
  const agent = new Agent({ keepAlive: true, maxSockets: CONNECTIONS });
  const until = Date.now() + 20_000;
  let sent = 0;
  const worker = async () => {
    while (Date.now() < until) {
      const url = `${env.PERF_PUBLIC_SHORT}/v1/content?limit=5&search=soak${sent++}`;
      await send(url, { headers: { host: API_HOST }, agent });
    }
  };
  await Promise.all(Array.from({ length: CONNECTIONS }, worker));
  agent.destroy();
  const soak = { requests: { total: sent } };
  const afterSoak = await size();
  await sleep(5000);
  const afterIdle = await size();
  results.tags = { requests: soak.requests.total, afterSoak, afterIdle };
  console.log(
    `tag set soak (${soak.requests.total} unique answers, ttl 3 s): ${JSON.stringify(results.tags)}`,
  );
}

client.close();
if (PROBE) {
  writeFileSync(env.PERF_PROBES, JSON.stringify(probes));
  process.exit(0);
}
if (env.PERF_JSON) {
  writeFileSync(env.PERF_JSON, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`written: ${env.PERF_JSON}`);
}
