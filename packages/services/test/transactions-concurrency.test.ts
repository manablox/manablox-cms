import type { ContentRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

/** A subtree copied in one transaction while another writer keeps writing. */
const DOCUMENTS = 200;

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('transactions_concurrency', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

describe('a long transaction beside other writers', () => {
  it('copies a subtree of 200 documents while another writer writes, without a busy failure', async () => {
    const rows: ContentRow[] = [];
    for (let index = 0; index < DOCUMENTS; index++) {
      // Ten children per node, so the tree is a few levels deep.
      const parent = index === 0 ? null : (rows[Math.floor((index - 1) / 10)] as ContentRow);
      rows.push(
        await ctx.content.create({
          spaceId: ctx.spaceId,
          typeId: ctx.ids.article as string,
          locale: 'en',
          parentId: parent?.id ?? null,
          title: `Document ${index}`,
          fields: { body: `<p>${index}</p>` },
        }),
      );
    }
    const root = rows[0] as ContentRow;

    let created = 0;
    const off = ctx.manablox.hooks.on('content:afterCreate', () => {
      created++;
    });
    const failures: unknown[] = [];
    let writing = true;
    let written = 0;
    const writer = (async () => {
      while (writing) {
        try {
          await ctx.repos.spaces.update(ctx.spaceId, { description: `tick ${written}` });
          await ctx.content.create({
            spaceId: ctx.spaceId,
            typeId: ctx.ids.article as string,
            locale: 'en',
            title: `Beside ${written}`,
            fields: {},
          });
          written++;
        } catch (error) {
          failures.push(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();

    const copy = await ctx.content.duplicate(ctx.spaceId, root.id, null, { children: true });
    writing = false;
    await writer;
    off();

    expect(failures).toEqual([]);
    expect(written).toBeGreaterThan(0);
    const copied = await ctx.repos.content.page(
      { spaceId: ctx.spaceId, under: copy.id },
      { limit: 1, offset: 0 },
    );
    // `under` counts the copy itself.
    expect(copied.total).toBe(DOCUMENTS);
    expect(created).toBe(DOCUMENTS + written);
  }, 300_000);
});
