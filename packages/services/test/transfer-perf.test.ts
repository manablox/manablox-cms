import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import type { SpaceExport } from '../src/transfer/format.js';
import { SpaceTransferService } from '../src/transfer/service.js';
import { TEST_TYPES } from './helpers/types.js';

/**
 * Statement counts of a whole-space transfer. The ceilings are loose on purpose: they
 * catch per-row loops, not exact counts. `PERF=1` prints the numbers.
 */
const DOCUMENTS = 60;

let ctx: ServiceContext;
let transfer: SpaceTransferService;

beforeAll(async () => {
  ctx = await createServiceContext('transfer_perf', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  transfer = new SpaceTransferService(ctx.manablox, ctx.repos);

  const asset = await ctx.repos.assets.create({
    spaceId: ctx.spaceId,
    driver: 'local',
    key: 'perf/hero.jpg',
    filename: 'hero.jpg',
    name: 'Hero',
    mimeType: 'image/jpeg',
    size: 10,
  });
  for (let index = 0; index < DOCUMENTS; index++) {
    const row = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: `Doc ${index}`,
      slug: `doc-${index}`,
      fields: { hero: asset.id },
    });
    if (index % 3 === 0) await ctx.content.publish(ctx.spaceId, row.id);
  }
}, 300_000);

afterAll(async () => {
  await ctx?.close();
});

/** The payload under a fresh identity, for importing into the same instance. */
function asCopy(payload: SpaceExport, machineName: string): SpaceExport {
  const remap = new Map<string, string>();
  const fresh = (id: string) => {
    const mapped = remap.get(id) ?? crypto.randomUUID();
    remap.set(id, mapped);
    return mapped;
  };
  return {
    ...payload,
    space: { ...payload.space, id: crypto.randomUUID(), machineName, name: machineName },
    ...(payload.contents
      ? {
          contents: payload.contents.map((row) => ({
            ...row,
            id: fresh(row.id),
            localizationId: fresh(row.localizationId),
            parentId: row.parentId ? fresh(row.parentId) : null,
            fields: {
              ...row.fields,
              hero: row.fields.hero ? fresh(row.fields.hero as string) : null,
            },
            ...(row.versions
              ? {
                  versions: row.versions.map((version) => ({
                    ...version,
                    snapshot: { ...version.snapshot, id: fresh(row.id) },
                  })),
                }
              : {}),
          })),
        }
      : {}),
    ...(payload.assets
      ? {
          assets: payload.assets.map((a) => ({
            ...a,
            id: fresh(a.id),
            key: `${machineName}/${a.key}`,
          })),
        }
      : {}),
  };
}

function report(label: string, count: number): void {
  if (!process.env.PERF) return;
  console.log(`[perf] ${label}: ${count} statements`);
  // Statements grouped by their first few words.
  const groups = new Map<string, number>();
  for (const query of ctx.queries()) {
    const shape = query.replace(/\s+/g, ' ').trim().slice(0, 60);
    groups.set(shape, (groups.get(shape) ?? 0) + 1);
  }
  for (const [shape, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${shape}`);
  }
}

describe(`space transfer statement counts (${DOCUMENTS} documents)`, () => {
  let payload: SpaceExport;

  it('inventories a space in a fixed number of statements', async () => {
    ctx.resetQueryCount();
    await transfer.inventory(ctx.spaceId);
    const count = ctx.queryCount();
    report('inventory', count);
    expect(count).toBeLessThan(20);
  });

  it('exports a space without a statement per row', async () => {
    ctx.resetQueryCount();
    payload = await transfer.export(ctx.spaceId);
    const count = ctx.queryCount();
    report('export', count);
    expect(payload.contents).toHaveLength(DOCUMENTS);
    expect(count).toBeLessThan(DOCUMENTS);
  });

  it('imports a space without a statement per row', async () => {
    ctx.resetQueryCount();
    const result = await transfer.import(asCopy(payload, 'perf-copy'), null);
    const count = ctx.queryCount();
    report('import', count);
    expect(result.contents).toBe(DOCUMENTS);
    // Inserts and publishing are inherently per document (path and permalink derive from
    // the parent); everything else is batched.
    expect(count / DOCUMENTS).toBeLessThan(8);
  });

  it('assigns imported tags in one statement per table', async () => {
    const copy = asCopy(payload, 'perf-tagged');
    copy.contents = (copy.contents ?? []).map((row, index) => ({
      ...row,
      tags: ['Shared', `Doc ${index}`],
    }));
    copy.assets = (copy.assets ?? []).map((row) => ({ ...row, tags: ['Shared', 'Hero'] }));
    ctx.resetQueryCount();
    const result = await transfer.import(copy, null);
    const inserts = (table: string) =>
      ctx.queries().filter((query) => new RegExp(`^insert into "${table}"`, 'i').test(query))
        .length;
    expect(inserts('content_tags')).toBe(1);
    expect(inserts('asset_tags')).toBe(1);

    const groups = (copy.contents ?? []).map((row) => row.localizationId);
    const byGroup = await ctx.repos.tags.listByLocalizations(groups);
    expect(byGroup.size).toBe(DOCUMENTS);
    expect(byGroup.get(groups[1] as string)?.map((tag) => tag.name)).toEqual(['Doc 1', 'Shared']);
    const assetId = copy.assets?.[0]?.id as string;
    const assetTags = await ctx.repos.tags.listByAssets([assetId], result.spaceId);
    expect(assetTags.get(assetId)?.map((tag) => tag.name)).toEqual(['Hero', 'Shared']);
  });
});
