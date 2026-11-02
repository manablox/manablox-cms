import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { createClient } from '@manablox/public-sdk';
import { bootstrap, createApp, type Runtime, requireManagement } from '@manablox/server';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websitePlugin } from '../../src/index.js';

const DESIGN = { variant: 'dark', style: { textAlign: 'center' } };

let db: TestDatabase;
let api: Runtime;
let pub: Runtime;
let pubApp: Hono;
let documentId: string;

beforeAll(async () => {
  db = await createTestDatabase('block_design_delivery', {
    plugins: [websitePlugin()],
  });
  const config = {
    plugins: [websitePlugin()],
    database: { url: db.url },
    auth: { secret: 'block-design-delivery-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
    logLevel: 'silent' as const,
  };
  const management = requireManagement(
    await bootstrap({ ...config, server: { rateLimit: false, scopes: ['rpc'] } }),
  );
  api = management;
  const space = await management.repos.spaces.create({
    name: 'Blocks',
    machineName: 'blocks',
    url: 'https://blocks.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  const spaceId = space.id;
  const teaser = await management.contentTypes.create({
    name: 'teaser',
    kind: 'block',
    spaceId,
    fields: [{ name: 'headline', type: 'string' }],
  });
  const page = await management.contentTypes.create({
    name: 'page',
    spaceId,
    fields: [{ name: 'components', type: 'blocks' }],
  });
  const created = await management.content.create({
    spaceId,
    typeId: page.id,
    title: 'Home',
    slug: 'home',
    fields: {
      components: {
        blocks: [
          {
            blockId: crypto.randomUUID(),
            type: teaser.id,
            fields: { headline: 'Designed' },
            ext: { website: DESIGN },
          },
        ],
      },
    },
  });
  documentId = created.id;
  await management.content.publish(spaceId, documentId);

  pub = await bootstrap({
    ...config,
    server: { mode: 'public', rateLimit: false },
    publicApi: { spaceId },
  });
  pubApp = await createApp(pub);
}, 90_000);

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
});

const client = (transport: 'graphql' | 'rest', blockExtensions?: string[]) =>
  createClient({
    url: 'http://public.test',
    transport,
    cache: false,
    ...(blockExtensions ? { blockExtensions } : {}),
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      pubApp.request(input instanceof Request ? input : new Request(input, init))) as typeof fetch,
  });

const SELECTION =
  '... on Page { components { blocks { blockId typeName ... on Teaser { headline design { variant style } } } } }';

const firstBlock = async (transport: 'graphql' | 'rest', blockExtensions?: string[]) => {
  const page = await client(transport, blockExtensions).get(documentId, {
    ...(transport === 'graphql' ? { selection: SELECTION } : {}),
  });
  return (page?.fields.components as { blocks: Array<Record<string, unknown>> }).blocks[0];
};

describe("a block's website design over the public API", () => {
  it('stays on the block over both transports with `blockExtensions: [design]`', async () => {
    for (const transport of ['graphql', 'rest'] as const) {
      const block = await firstBlock(transport, ['design']);
      expect(block?.design, transport).toEqual(DESIGN);
      expect(block?.fields, transport).toEqual({ headline: 'Designed' });
    }
  });

  it('reads as a field on GraphQL without the option, and stays apart on REST', async () => {
    expect((await firstBlock('graphql'))?.fields).toEqual({
      headline: 'Designed',
      design: DESIGN,
    });
    const rest = await firstBlock('rest');
    expect(rest?.design).toEqual(DESIGN);
    expect(rest?.fields).toEqual({ headline: 'Designed' });
  });
});
