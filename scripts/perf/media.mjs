// `scripts/perf.sh media`: PERF_MEDIA_PARALLEL (20) downloads of the seed's big asset at
// once from the management process, and that process's resident memory while they run.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get } from 'node:http';

const env = process.env;
const seed = JSON.parse(readFileSync(env.PERF_SEED, 'utf8'));
if (!seed.bigAsset) throw new Error('no big asset; seed with PERF_BIG_ASSET_MB=200');
const PARALLEL = Number(env.PERF_MEDIA_PARALLEL ?? 20);
const url = `${env.PERF_MGMT}/media/${seed.bigAsset}/original`;

const pid = execFileSync('fuser', [`${env.PERF_MGMT_PORT}/tcp`], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
  .trim()
  .split(/\s+/)[0];
const rssMb = () => {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  return Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
};

/** Downloads one copy, counting bytes and reading slowly enough to keep all of them open. */
const download = () =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    get(url, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
      });
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          bytes,
          ms: performance.now() - started,
          headers: res.headers,
        }),
      );
      res.on('error', reject);
    }).on('error', reject);
  });

const before = rssMb();
let peak = before;
const timer = setInterval(() => {
  peak = Math.max(peak, rssMb());
}, 50);
const started = performance.now();
const results = await Promise.all(Array.from({ length: PARALLEL }, download));
const wall = performance.now() - started;
clearInterval(timer);
peak = Math.max(peak, rssMb());

const statuses = [...new Set(results.map((each) => each.status))];
const bytes = results[0]?.bytes ?? 0;
console.log(
  JSON.stringify({
    label: env.PERF_LABEL,
    parallel: PARALLEL,
    statuses,
    mbEach: Math.round(bytes / 1024 / 1024),
    allComplete: results.every((each) => each.bytes === bytes),
    wallMs: Math.round(wall),
    rssBeforeMb: Math.round(before),
    rssPeakMb: Math.round(peak),
    headers: {
      etag: results[0]?.headers.etag ?? null,
      acceptRanges: results[0]?.headers['accept-ranges'] ?? null,
      contentLength: results[0]?.headers['content-length'] ?? null,
    },
  }),
);
