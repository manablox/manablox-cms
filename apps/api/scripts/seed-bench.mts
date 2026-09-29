/**
 * Fills the dev stack's space with published documents so `scripts/bench.sh` has
 * something to serve. Idempotent: it tops the space up to `COUNT` and leaves what is
 * already there alone. Development only - it writes straight through the service layer
 * against `DATABASE_URL`.
 *
 *   docker exec manablox-cms-dev-api-1 sh -c 'cd /app/apps/api && pnpm tsx scripts/seed-bench.mts'
 */
import { bootstrap } from '@manablox/server';
import { config } from '../src/config.js';

const COUNT = Number(process.env.COUNT ?? 200);

const runtime = await bootstrap({ ...config, logLevel: 'silent' });
const spaces = await runtime.repos.spaces.list();
const wanted = process.env.MANABLOX_SPACE ?? 'manablox';
const space = spaces.find((row) => row.machineName === wanted) ?? spaces[0];
if (!space) throw new Error('no space to seed; create one in the admin first');

const type = runtime.manablox.contentTypes
  .forSpace(space.id)
  .find((candidate) => candidate.kind !== 'block' && candidate.isPublishable);
if (!type) throw new Error('no content type to seed');

const { total: have } = await runtime.repos.content.page(
  { spaceId: space.id },
  { limit: 1, offset: 0 },
);
console.log(`space ${space.machineName}: ${have} documents, type ${type.name}, target ${COUNT}`);

for (let index = have; index < COUNT; index++) {
  const row = await runtime.content.create({
    spaceId: space.id,
    typeId: type.id,
    locale: space.defaultLocale,
    title: `Bench document ${index}`,
    slug: `bench-${index}`,
    fields: {},
  });
  await runtime.content.publish(space.id, row.id);
  if (index % 25 === 0) console.log(`  ${index}`);
}

const { total } = await runtime.repos.content.page({ spaceId: space.id }, { limit: 1, offset: 0 });
console.log(`done: ${total} documents`);
await runtime.shutdown();
process.exit(0);
