import { Manablox } from '@manablox/core/node';
import { builtinFieldTypes } from '@manablox/fields';
import { type GraphQLSchema, graphql } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GraphQLContext } from '../src/context.js';
import { buildSchema } from '../src/schema.js';

const CTX_SPACE = 'aaaaaaaa-1111-4111-8111-111111111111';
const ARG_SPACE = 'bbbbbbbb-2222-4222-8222-222222222222';

let manablox: Manablox;
let open: GraphQLSchema;
let pinned: GraphQLSchema;

beforeAll(async () => {
  manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    contentTypes: [{ name: 'page', fields: [{ name: 'body', type: 'string' }] }],
  });
  await manablox.init();
  open = buildSchema(manablox);
  pinned = buildSchema(manablox, { pinnedSpace: true });
});

/** A context whose reader records each list call and answers with a fixed total. */
const context = (spaceId: string | null) => {
  const calls: { spaceId: string; args: Record<string, unknown> }[] = [];
  const reader = {
    list: async (space: string, args: Record<string, unknown>) => {
      calls.push({ spaceId: space, args });
      return { items: [], total: 42, limit: Number(args.limit), offset: Number(args.offset) };
    },
  };
  return { calls, value: { spaceId, reader } as unknown as GraphQLContext };
};

const run = (schema: GraphQLSchema, source: string, contextValue: GraphQLContext) =>
  graphql({ schema, source, contextValue });

describe('contentsPage', () => {
  it('returns the reader page with its total, limit and offset', async () => {
    const ctx = context(CTX_SPACE);
    const result = await run(
      open,
      '{ contentsPage(type: "page", limit: 5, offset: 10, tags: "a,b") { total limit offset items { id } } }',
      ctx.value,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.contentsPage).toEqual({ total: 42, limit: 5, offset: 10, items: [] });
    expect(ctx.calls).toEqual([
      {
        spaceId: CTX_SPACE,
        args: expect.objectContaining({ type: 'page', limit: 5, offset: 10, tags: 'a,b' }),
      },
    ]);
  });

  it('defaults limit to 25 and offset to 0', async () => {
    const ctx = context(CTX_SPACE);
    const result = await run(open, '{ contentsPage { limit offset } }', ctx.value);
    expect(result.data?.contentsPage).toEqual({ limit: 25, offset: 0 });
  });

  it('answers an empty page without asking the reader when no space is known', async () => {
    const ctx = context(null);
    const result = await run(
      open,
      '{ contentsPage(limit: 7, offset: 3) { total limit offset items { id } } }',
      ctx.value,
    );
    expect(result.data?.contentsPage).toEqual({ total: 0, limit: 7, offset: 3, items: [] });
    expect(ctx.calls).toEqual([]);
  });

  it('prefers the spaceId argument over the request space on a shared instance', async () => {
    const ctx = context(CTX_SPACE);
    await run(open, `{ contentsPage(spaceId: "${ARG_SPACE}") { total } }`, ctx.value);
    expect(ctx.calls.map((call) => call.spaceId)).toEqual([ARG_SPACE]);
  });
});

describe('pinned space', () => {
  it('removes the spaceId argument from every root field', () => {
    const fields = pinned.getQueryType()?.getFields() ?? {};
    for (const field of Object.values(fields)) {
      expect(field.args.map((arg) => arg.name)).not.toContain('spaceId');
    }
    expect(
      open
        .getQueryType()
        ?.getFields()
        .contentsPage?.args.map((arg) => arg.name),
    ).toContain('spaceId');
  });

  it('rejects a spaceId argument instead of ignoring it', async () => {
    const ctx = context(CTX_SPACE);
    const result = await run(
      pinned,
      `{ contentsPage(spaceId: "${ARG_SPACE}") { total } }`,
      ctx.value,
    );
    expect(result.errors?.[0]?.message).toMatch(/Unknown argument "spaceId"/);
    expect(ctx.calls).toEqual([]);
  });

  it('lists the pinned space', async () => {
    const ctx = context(CTX_SPACE);
    const result = await run(pinned, '{ contentsPage { total } }', ctx.value);
    expect(result.data?.contentsPage).toEqual({ total: 42 });
    expect(ctx.calls.map((call) => call.spaceId)).toEqual([CTX_SPACE]);
  });
});
