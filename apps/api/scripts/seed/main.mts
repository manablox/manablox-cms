/**
 * Fills an instance with enough of everything to test against: content types and block
 * types with every field type between them, a deep content tree with blocks inside
 * blocks, translations, assets, templates, menus, credentials, endpoints and workflows.
 *
 * Development only. It writes through the service layer against `DATABASE_URL`, so every
 * row gets the hooks, the audit entries and the search text an editor's save would, which
 * is the point - a seed written straight into the tables tests the tables, not the system.
 *
 *   docker exec manablox-cms-dev-api-1 sh -c 'cd /app/apps/api && pnpm seed:testing'
 *
 * Knobs, all optional:
 *   SEED_SCALE=small|medium|large   how much of everything (default medium)
 *   SEED=1234                       the faker seed; the same number builds the same data
 *   SEED_SPACES=2                   spaces to build, on top of what the instance has
 *   SEED_SPACE=machine-name         fill this existing space instead of making new ones
 *   SEED_ARM=1                      leave the event and schedule workflows switched on
 *   plus SEED_BLOCK_TYPES, SEED_CONTENT_TYPES, SEED_ASSETS, SEED_TEMPLATES, SEED_ROOTS,
 *   SEED_DEPTH, SEED_MENUS, SEED_CREDENTIALS, SEED_WEBHOOKS, SEED_WORKFLOWS, SEED_LOCALES
 */
import { isFolderType, isTemplateType } from '@manablox/core';
import type {} from '@manablox/plugin-webhooks';
import type {} from '@manablox/plugin-workflows';
import { bootstrap, requireManagement } from '@manablox/server';
import { config } from '../../src/config.js';
import { buildAssets } from './assets.mts';
import { armed, buildCredentials, buildWebhooks, buildWorkflows } from './automation.mts';
import { buildMenus, buildTemplates, buildTree, type ValueContext } from './content.mts';
import { buildBlockTypes, buildContentTypes } from './model.mts';
import { chance, faker, seedFaker, sentence } from './random.mts';
import { resolveScale } from './scale.mts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('the testing seed writes hundreds of rows; it is not meant for production');
}

const { name: scaleName, scale } = resolveScale();
const seed = Number(process.env.SEED ?? 20260909);
seedFaker(seed);

const started = Date.now();
const runtime = requireManagement(
  await bootstrap({ ...config, logLevel: process.env.LOG_LEVEL ?? 'warn' }),
);

const totals = {
  spaces: 0,
  contentTypes: 0,
  blockTypes: 0,
  fields: 0,
  assets: 0,
  templates: 0,
  documents: 0,
  folders: 0,
  translations: 0,
  published: 0,
  scheduled: 0,
  publishesRefused: 0,
  blocks: 0,
  approvals: 0,
  menus: 0,
  credentials: 0,
  webhooks: 0,
  workflows: 0,
};

/** Who the seed writes as: the first account on the instance, when there is one. */
const users = await runtime.repos.users.page({ limit: 20, offset: 0 });
const owner = users.items[0] ?? null;
const actor = owner ? { userId: owner.id, roles: ['owner', 'admin'] } : null;
const userIds = users.items.map((user) => user.id);
if (!owner) console.warn('no user on this instance; the seed writes without an actor');

/** Counts the blocks in a stored value, however deep they sit. */
function countBlocks(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce<number>((sum, entry) => sum + countBlocks(entry), 0);
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const here = typeof record.blockId === 'string' && typeof record.type === 'string' ? 1 : 0;
  return here + Object.values(record).reduce<number>((sum, entry) => sum + countBlocks(entry), 0);
}

const existing = await runtime.repos.spaces.list();
const takenMachineNames = new Set(existing.map((space) => space.machineName));

/** The spaces this run fills: the one `SEED_SPACE` names, or freshly created ones. */
const targets = [];
if (process.env.SEED_SPACE) {
  const wanted = existing.find((space) => space.machineName === process.env.SEED_SPACE);
  if (!wanted) throw new Error(`no space with machine name "${process.env.SEED_SPACE}"`);
  targets.push(wanted);
} else {
  for (let index = 0; index < scale.spaces; index++) {
    const label = faker.company.name();
    const stem = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    // A run with the same seed picks the same names as the last one, so a taken name gets
    // a suffix rather than another repetition of the same suffix.
    let machineName = stem;
    while (takenMachineNames.has(machineName)) {
      machineName = `${stem}-${faker.string.alphanumeric({ length: 4, casing: 'lower' })}`;
    }
    takenMachineNames.add(machineName);
    targets.push(
      await runtime.spaces.create(
        {
          name: label,
          machineName,
          description: sentence(12),
          url: `https://${machineName}.example.test`,
          defaultLocale: scale.locales[0] ?? 'en',
          locales: scale.locales,
        },
        owner?.id ?? null,
      ),
    );
    totals.spaces += 1;
  }
}

console.log(
  `seed ${seed}, scale ${scaleName}, ${targets.length} space(s): ${targets.map((space) => space.machineName).join(', ')}`,
);

for (const space of targets) {
  const locale = space.defaultLocale;
  console.log(`\n[${space.machineName}]`);

  // 1. Block types, leaves before composites, so a composite can hold a leaf.
  const blockTypes = await buildBlockTypes(
    runtime.contentTypes,
    space.id,
    scale.blockTypes,
    owner?.id ?? null,
    scale.fieldsPerType,
  );
  totals.blockTypes += blockTypes.length;
  console.log(`  block types: ${blockTypes.length}`);

  // 2. The media library. Templates and documents both point at it, so it comes first.
  const assets = await buildAssets(runtime.media, space.id, scale.assets, owner?.id ?? null);
  totals.assets += assets.length;
  console.log(`  assets: ${assets.length}`);

  const byId = new Map(runtime.contentTypes.list(space.id).map((type) => [type.id, type]));
  const context: ValueContext = {
    byId,
    blockTypes,
    assets,
    userIds,
    documents: [],
    templateIds: [],
    blocksPerField: scale.blocksPerField,
  };

  // 3. Templates: documents of the system template type, so a `template` field on a type
  //    built in the next step has something to offer.
  const templateType = runtime.contentTypes.list(space.id).find((type) => isTemplateType(type));
  if (templateType) {
    const templates = await buildTemplates(
      runtime.content,
      space.id,
      templateType,
      locale,
      scale.templates,
      context,
      actor,
    );
    context.templateIds = templates.map((row) => row.id);
    totals.templates += templates.length;
    console.log(`  templates: ${templates.length}`);
  }

  // 4. The document types.
  const contentTypes = await buildContentTypes(
    runtime.contentTypes,
    space.id,
    scale.contentTypes,
    owner?.id ?? null,
    { blockTypeIds: blockTypes.map((type) => type.id), templateIds: context.templateIds },
    scale.fieldsPerType,
  );
  totals.contentTypes += contentTypes.length;
  totals.fields += [...blockTypes, ...contentTypes].reduce(
    (sum, type) => sum + type.fields.length,
    0,
  );
  console.log(`  content types: ${contentTypes.length}`);

  // The registry has changed twice over; the value generator reads types by id.
  for (const type of runtime.contentTypes.list(space.id)) byId.set(type.id, type);

  // 5. The tree.
  const folderType = runtime.contentTypes.list(space.id).find((type) => isFolderType(type)) ?? null;
  const tree = await buildTree(
    runtime.content,
    {
      spaceId: space.id,
      locales: space.locales,
      roots: scale.roots,
      childrenPerNode: scale.childrenPerNode,
      depth: scale.depth,
      published: scale.published,
      translated: scale.translated,
      types: contentTypes,
      folderType,
    },
    context,
    actor,
    (created) => {
      if (created % 50 === 0) console.log(`    ${created} documents`);
    },
  );
  totals.documents += tree.documents.length;
  totals.folders += tree.folders;
  totals.published += tree.published;
  totals.translations += tree.translations;
  totals.scheduled += tree.scheduled;
  totals.publishesRefused += tree.failed;
  totals.blocks += tree.documents.reduce((sum, row) => sum + countBlocks(row.fields), 0);
  console.log(
    `  documents: ${tree.documents.length} plus ${tree.translations} translations (${tree.published} published, ${tree.folders} folders, ${tree.scheduled} scheduled${tree.failed ? `, ${tree.failed} refused` : ''})`,
  );

  // 6. Review requests, so the approval queue is not empty on the types that ask for one.
  const reviewable = tree.documents.filter((row) => {
    const type = byId.get(row.typeId);
    return type?.requiresApproval === true && row.status !== 'published';
  });
  for (const row of reviewable) {
    if (!chance(0.6)) continue;
    try {
      await runtime.approvals.request(space.id, row.id, actor, sentence(8));
      totals.approvals += 1;
      // Some of them are decided, so the queue holds a history rather than only a backlog.
      if (chance(0.3)) await runtime.approvals.approve(space.id, row.id, actor, sentence(6));
      else if (chance(0.2)) await runtime.approvals.reject(space.id, row.id, actor, sentence(6));
    } catch (error) {
      console.warn(`  approval on ${row.id} skipped: ${(error as Error).message}`);
    }
  }
  if (totals.approvals) console.log(`  approval requests: ${totals.approvals}`);

  // 7. Menus, over the documents whose types may appear in one.
  const menuable = tree.documents.filter(
    (row) => byId.get(row.typeId)?.canBeVisibleInMenu === true,
  );
  totals.menus += await buildMenus(runtime.menus, space.id, scale.menus, menuable, new Set());
  console.log(`  menus: ${scale.menus}`);

  // 8. The home page, so delivery has a root to answer for.
  const home = tree.documents.find(
    (row) => row.parentId === null && row.status === 'published' && byId.get(row.typeId)?.hasSlug,
  );
  if (home) await runtime.spaces.setHome(space.id, home.id);

  // 9. Automation: the vault, then the endpoints that use it, then the workflows.
  const credentials = await buildCredentials(runtime.credentials, space.id, scale.credentials);
  totals.credentials += credentials.length;
  const endpoints = await buildWebhooks(
    runtime.manablox.plugins.require('webhooks').webhooks,
    space.id,
    scale.webhooks,
    credentials,
    new Set(),
  );
  totals.webhooks += endpoints.incoming.length + endpoints.outgoing.length;
  totals.workflows += await buildWorkflows(
    runtime.manablox.plugins.require('workflows').workflows,
    space.id,
    scale.workflows,
    contentTypes.map((type) => type.id),
    endpoints.incoming,
    credentials,
  );
  console.log(
    `  credentials: ${credentials.length}, webhooks: ${endpoints.incoming.length} in / ${endpoints.outgoing.length} out, workflows: ${scale.workflows}`,
  );
}

/**
 * Tells a running instance to re-read the content types. The registry is loaded once, at
 * boot, and reloaded in process when a type is saved through the admin: a seed writing
 * from a second process leaves the server that is already up serving a registry without
 * the new types in it, and every seeded document then 404s with `contentType.notFound`.
 *
 * The reload procedure wants a superadmin, so this issues a key, calls it and revokes the
 * key again. Best effort: no instance running, no superadmin, or a refusal all end in a
 * line saying what to do by hand rather than in a failed run.
 */
async function reloadRunningInstance(): Promise<void> {
  if (process.env.SEED_NO_RELOAD === '1') return;
  const url = (process.env.SEED_API_URL ?? runtime.manablox.config.server.publicUrl).replace(
    /\/$/,
    '',
  );
  const superadmin = users.items.find((user) => user.role === 'superadmin');
  const hint = `restart the API, or call POST ${url}/api/v1/contentTypes/reload, or the running instance will not know the new content types`;
  if (!superadmin) {
    console.log(
      `\ninstance not told about the new content types: no superadmin to call with; ${hint}`,
    );
    return;
  }

  const key = await runtime.apiKeys.issue(superadmin.id, 'testing seed reload');
  try {
    const response = await fetch(`${url}/api/v1/contentTypes/reload`, {
      method: 'POST',
      headers: { 'x-api-key': key.key, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) console.log(`\nthe instance at ${url} reloaded its content types`);
    else console.log(`\ninstance not reloaded (${response.status}): ${hint}`);
  } catch (error) {
    console.log(`\ninstance at ${url} not reachable (${(error as Error).message}): ${hint}`);
  } finally {
    await runtime.apiKeys.revoke(key.id);
  }
}

await reloadRunningInstance();

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\ndone in ${seconds}s`);
for (const [key, value] of Object.entries(totals)) console.log(`  ${key}: ${value}`);
if (!armed()) {
  console.log(
    '\nevent and schedule workflows and outgoing endpoints are switched off; SEED_ARM=1 leaves them on',
  );
}

await runtime.shutdown();
process.exit(0);
