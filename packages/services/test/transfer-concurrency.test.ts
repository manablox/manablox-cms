import { TEST_DIALECT } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { SPACE_EXPORT_VERSION, type SpaceExport } from '../src/transfer/format.js';
import { memoryStorage } from './helpers/storage.js';
import { TEST_TYPES } from './helpers/types.js';

/**
 * A large import shares the database with other writers: each chunk is short, so a write
 * issued meanwhile waits for one chunk, not the import. `PERF=1` prints the numbers.
 * SQLite holds one write queue, so it gets the full size.
 */
const DOCUMENTS = TEST_DIALECT === 'sqlite' ? 5000 : 1000;

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('transfer_concurrency', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    storage: memoryStorage(),
  });
});
afterAll(async () => {
  await ctx?.close();
});

function largeExport(): SpaceExport {
  const typeId = ctx.ids.article as string;
  const at = new Date('2026-01-01T00:00:00Z').toISOString();
  return {
    manabloxSpaceExport: SPACE_EXPORT_VERSION,
    exportedAt: at,
    sections: ['contents'],
    space: {
      id: crypto.randomUUID(),
      name: 'Large',
      machineName: 'large',
      description: null,
      url: 'http://large.test',
      defaultLocale: 'en',
      locales: ['en'],
      settings: {},
    },
    contents: Array.from({ length: DOCUMENTS }, (_, index) => {
      const id = crypto.randomUUID();
      return {
        id,
        typeId,
        locale: 'en',
        localizationId: crypto.randomUUID(),
        parentId: null,
        title: `Document ${index}`,
        slug: `document-${index}`,
        status: index % 2 === 0 ? 'published' : 'draft',
        position: index,
        fields: { body: `<p>Body ${index}</p>` },
        path: id.replaceAll('-', '_'),
        version: 1,
        createdAt: at,
        updatedAt: at,
        publishedAt: index % 2 === 0 ? at : null,
        publishAt: null,
        unpublishAt: null,
        tags: [`tag-${index % 20}`],
      };
    }),
  };
}

describe('space import beside other writers', () => {
  it('imports thousands of documents while another writer writes every 100 ms, without a busy failure', async () => {
    const payload = largeExport();
    const failures: unknown[] = [];
    const waits: number[] = [];
    let writing = true;
    let written = 0;

    const writer = (async () => {
      while (writing) {
        const started = performance.now();
        try {
          await ctx.repos.spaces.update(ctx.spaceId, { description: `tick ${written}` });
          written++;
        } catch (error) {
          failures.push(error);
        }
        waits.push(performance.now() - started);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();

    const chunks: number[] = [];
    const transaction = ctx.repos.transaction.bind(ctx.repos);
    const timed = vi.spyOn(ctx.repos, 'transaction').mockImplementation(async (fn) => {
      const at = performance.now();
      try {
        return await transaction(fn);
      } finally {
        chunks.push(performance.now() - at);
      }
    });
    const started = performance.now();
    const owner = await ctx.repos.users.create({
      name: 'Importer',
      email: 'importer@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    const result = await ctx.spaces.import(payload, owner.id);
    const took = performance.now() - started;
    writing = false;
    await writer;
    timed.mockRestore();

    expect(result).toMatchObject({ contents: DOCUMENTS, published: DOCUMENTS / 2 });
    expect(failures).toEqual([]);
    expect(written).toBeGreaterThan(5);
    const longest = Math.max(...waits);
    // Far below the 15 s SQLite busy timeout.
    expect(longest).toBeLessThan(5000);
    if (process.env.PERF) {
      process.stderr.write(
        `import ${Math.round(took)} ms in ${chunks.length} chunks (longest ${Math.round(Math.max(...chunks))} ms), ${written} concurrent writes, longest wait ${Math.round(longest)} ms\n`,
      );
    }
  }, 600_000);
});
