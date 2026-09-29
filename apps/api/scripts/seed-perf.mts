/**
 * Fills an instance for `scripts/perf.sh`: the large cases the delivery benchmark in
 * `scripts/bench.sh` has no data for. Development only; it writes through the service
 * layer against `DATABASE_URL`, like `seed:testing`. Re-running it tops up what is missing.
 *
 *   PERF_SPACES=1000 PERF_DOCUMENTS=20000 pnpm --filter @manablox/api seed:perf
 *
 * What it builds:
 * - `perf@manablox.test` / `perf-password-123` (superadmin), owner of every space below;
 * - `perf-site`: the API host `api.perf.test`, `PERF_PAGES` published pages (default 40) in a
 *   main menu, a home page;
 * - `perf-tree`: `PERF_DOCUMENTS` published documents (default 20000), `PERF_ROOTS` roots
 *   (default 1000) with the rest spread under them, and a `staging` environment copied in
 *   full, for tree, export and promote, with the API host `api-tree.perf.test` (lists at
 *   that size);
 * - `PERF_WEBHOOKS` enabled outgoing webhooks in `perf-site` (default 20) for every content
 *   event, pointing at a closed local port, for the cost of dispatching a save;
 * - `PERF_SPACES` empty spaces (default 1000), `perf-n-0001`..., for the session, each with
 *   `PERF_TYPES` content types (default 3), so the registry holds a few thousand;
 * - with `PERF_BIG_ASSET_MB` (default 0, off) one asset of that size in `perf-site`, for
 *   media streaming (needs `FILE_MAX_SIZE_MB` above it).
 *
 * Prints the ids the benchmark needs as one JSON line prefixed with `perf-seed:`.
 */
import type { WebhooksServices } from '@manablox/plugin-webhooks';
import { bootstrap, requireManagement } from '@manablox/server';
import { config } from '../src/config.js';

if (process.env.NODE_ENV === 'production') throw new Error('seed:perf is for development');

const SPACES = Number(process.env.PERF_SPACES ?? 1000);
const DOCUMENTS = Number(process.env.PERF_DOCUMENTS ?? 20_000);
const ROOTS = Number(process.env.PERF_ROOTS ?? 1000);
const PAGES = Number(process.env.PERF_PAGES ?? 40);
const BIG_ASSET_MB = Number(process.env.PERF_BIG_ASSET_MB ?? 0);
const TYPES = Number(process.env.PERF_TYPES ?? 3);
const WEBHOOKS = Number(process.env.PERF_WEBHOOKS ?? 20);
/** Documents written at once; each is a create and a publish. */
const PARALLEL = Number(process.env.PERF_PARALLEL ?? 8);

const PERF_ACCOUNT = { email: 'perf@manablox.test', password: 'perf-password-123' };

const started = Date.now();
const runtime = requireManagement(
  await bootstrap({ ...config, logLevel: process.env.LOG_LEVEL ?? 'warn' }),
);
const webhooks = runtime.manablox.plugin<WebhooksServices>('webhooks').services;

const log = (message: string) =>
  console.log(`seed:perf ${((Date.now() - started) / 1000).toFixed(1)}s ${message}`);

async function account(): Promise<string> {
  const found = await runtime.repos.users.findByEmail(PERF_ACCOUNT.email);
  if (found) return found.id;
  const user = await runtime.users.create({
    name: 'Perf',
    email: PERF_ACCOUNT.email,
    password: PERF_ACCOUNT.password,
    role: 'superadmin',
    emailVerified: true,
  });
  return user.id;
}

async function space(machineName: string, name: string, ownerId: string) {
  const found = await runtime.repos.spaces.findByMachineName(machineName);
  if (found) return found;
  return runtime.spaces.create(
    {
      name,
      machineName,
      url: `https://${machineName}.perf.test`,
      defaultLocale: 'en',
      locales: ['en'],
    },
    ownerId,
  );
}

async function pageType(spaceId: string, ownerId: string) {
  const found = runtime.contentTypes.list(spaceId).find((type) => type.name === 'page');
  if (found) return found;
  return runtime.contentTypes.create(
    {
      name: 'page',
      spaceId,
      fields: [
        { name: 'summary', type: 'string' },
        { name: 'body', type: 'string' },
      ],
    },
    ownerId,
  );
}

async function count(spaceId: string): Promise<number> {
  return (await runtime.repos.content.page({ spaceId }, { limit: 1, offset: 0 })).total;
}

/** Runs `work(index)` for `from..to-1`, `PARALLEL` at a time. */
async function inParallel(from: number, to: number, work: (index: number) => Promise<void>) {
  let next = from;
  const worker = async () => {
    while (next < to) {
      const index = next++;
      await work(index);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

const actorOf = (userId: string) => ({ userId, roles: ['owner'] });

const ownerId = await account();

// --- perf-site ---------------------------------------------------------------
const site = await space('perf-site', 'Perf site', ownerId);
const siteType = await pageType(site.id, ownerId);
const sitePages = await count(site.id);
const pages: Array<{ id: string; localizationId: string }> = [];
for (let index = sitePages; index < PAGES; index++) {
  const row = await runtime.content.create(
    {
      spaceId: site.id,
      typeId: siteType.id,
      locale: 'en',
      title: index === 0 ? 'Home' : `Page ${index}`,
      slug: index === 0 ? 'home' : `page-${index}`,
      fields: {
        summary: `Summary of page ${index}`,
        body: 'Lorem ipsum dolor sit amet. '.repeat(40),
      },
    },
    actorOf(ownerId),
  );
  await runtime.content.publish(site.id, row.id, actorOf(ownerId));
  pages.push(row);
}
if (sitePages === 0 && pages[0]) {
  await runtime.spaces.setHome(site.id, pages[0].id);
  const menu = await runtime.menus.create({ spaceId: site.id, name: 'Main', machineName: 'main' });
  await runtime.menus.setItems(
    site.id,
    menu.id,
    pages.slice(0, 6).map((page) => ({ localizationId: page.localizationId })),
  );
  await runtime.apiHosts.create(site.id, 'api.perf.test');
}
log(`perf-site: ${await count(site.id)} documents`);
const hooks = (await webhooks.webhooks.list(site.id, 'outgoing', { limit: 200, offset: 0 })).total;
for (let index = hooks; index < WEBHOOKS; index++) {
  await webhooks.webhooks.create(site.id, {
    direction: 'outgoing',
    name: `Perf hook ${index + 1}`,
    url: 'http://127.0.0.1:9/hook',
    events: [],
    enabled: true,
  });
}
log(`perf-site: ${WEBHOOKS} webhooks`);

let bigAsset: string | null = null;
if (BIG_ASSET_MB > 0) {
  const existing = (
    await runtime.repos.assets.page({ spaceId: site.id }, { limit: 100, offset: 0 })
  ).items.find((asset) => asset.filename === `big-${BIG_ASSET_MB}.txt`);
  if (existing) bigAsset = existing.id;
  else {
    const line = Buffer.from('manablox perf streaming line of text, 64 bytes long..........\n');
    const body = Buffer.alloc(BIG_ASSET_MB * 1024 * 1024);
    for (let offset = 0; offset < body.length; offset += line.length) line.copy(body, offset);
    const asset = await runtime.media.upload({
      spaceId: site.id,
      filename: `big-${BIG_ASSET_MB}.txt`,
      mimeType: 'text/plain',
      body,
      alt: '',
      title: 'Big file',
      actorId: ownerId,
    });
    bigAsset = asset.id;
  }
  log(`big asset ${bigAsset} (${BIG_ASSET_MB} MB)`);
}

// --- perf-tree ---------------------------------------------------------------
const tree = await space('perf-tree', 'Perf tree', ownerId);
const treeType = await pageType(tree.id, ownerId);
let have = await count(tree.id);
const roots: string[] = (
  await runtime.repos.content.page(
    { spaceId: tree.id, parentId: null },
    { limit: ROOTS, offset: 0 },
  )
).items.map((row) => row.id);
const write = async (index: number, parentId: string | null) => {
  const row = await runtime.content.create(
    {
      spaceId: tree.id,
      typeId: treeType.id,
      locale: 'en',
      ...(parentId ? { parentId } : {}),
      title: `Document ${index}`,
      slug: `doc-${index}`,
      position: index,
      fields: { summary: `Summary ${index}`, body: 'Tree body text. '.repeat(20) },
    },
    actorOf(ownerId),
  );
  await runtime.content.publish(tree.id, row.id, actorOf(ownerId));
  return row.id;
};
if (roots.length < Math.min(ROOTS, DOCUMENTS)) {
  const from = roots.length;
  await inParallel(from, Math.min(ROOTS, DOCUMENTS), async (index) => {
    roots.push(await write(index, null));
  });
  have = await count(tree.id);
}
if (have < DOCUMENTS) {
  const from = have;
  await inParallel(from, DOCUMENTS, async (index) => {
    await write(index, roots[index % roots.length] ?? null);
    if (index % 1000 === 0) log(`perf-tree: ${index}`);
  });
}
log(`perf-tree: ${await count(tree.id)} documents`);
const environments = await runtime.environments.list(tree.id);
if (!environments.some((row) => row.machineName === 'staging')) {
  await runtime.environmentLifecycle.create(tree.id, {
    machineName: 'staging',
    name: 'Staging',
    mode: 'full',
  });
  log('perf-tree: staging copied');
}

if (!(await runtime.apiHosts.resolve('api-tree.perf.test'))) {
  await runtime.apiHosts.create(tree.id, 'api-tree.perf.test');
  log('perf-tree: API host');
}

// --- empty spaces --------------------------------------------------------------
const total = (await runtime.repos.spaces.list()).length;
for (let index = Math.max(0, total - 2); index < SPACES; index++) {
  const name = `perf-n-${String(index + 1).padStart(4, '0')}`;
  await space(name, name, ownerId);
  if (index % 100 === 0) log(`spaces: ${index}`);
}
log(`spaces: ${(await runtime.repos.spaces.list()).length}`);
let typed = 0;
for (const row of await runtime.repos.spaces.list()) {
  if (!row.machineName.startsWith('perf-n-')) continue;
  const have = new Set(runtime.contentTypes.list(row.id).map((type) => type.name));
  for (let index = 0; index < TYPES; index++) {
    if (have.has(`kind${index + 1}`)) continue;
    await runtime.contentTypes.create(
      {
        name: `kind${index + 1}`,
        spaceId: row.id,
        fields: [
          { name: 'summary', type: 'string' },
          { name: 'body', type: 'richtext' },
        ],
      },
      ownerId,
    );
  }
  if (++typed % 100 === 0) log(`types: ${typed} spaces`);
}
log(`types: ${runtime.manablox.contentTypes.contentTypes.length} in the registry`);

const sample = await runtime.repos.spaces.findByMachineName('perf-n-0001');
const sampleType = sample
  ? runtime.contentTypes.list(sample.id).find((type) => type.name === 'kind1')
  : undefined;
console.log(
  `perf-seed: ${JSON.stringify({
    site: site.id,
    tree: tree.id,
    bigAsset,
    rootId: roots[0] ?? null,
    typedSpace: sample?.id ?? null,
    typedType: sampleType?.id ?? null,
  })}`,
);
await runtime.shutdown();
process.exit(0);
