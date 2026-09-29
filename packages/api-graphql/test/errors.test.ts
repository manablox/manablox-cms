import { ManabloxError } from '@manablox/core';
import { buildSchema as buildSdl, GraphQLError } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { describe, expect, it, vi } from 'vitest';
import { manabloxErrorsPlugin, toGraphQLError } from '../src/errors.js';

const schema = buildSdl(`
  type Query { notFound: String internal: String plain: String invalid: String ok: String }
`);

const rootValue = {
  notFound: () => {
    throw ManabloxError.notFound('content.notFound', { id: 'x' });
  },
  internal: () => {
    throw new ManabloxError('internal.error', {
      details: [{ key: 'internal.error', params: { dsn: 'pw' } }],
    });
  },
  plain: () => {
    throw new Error('db-internal-42');
  },
  invalid: () => {
    throw Object.assign(new Error('bad input'), {
      data: { issues: [{ message: 'Required', path: ['name'] }] },
    });
  },
  ok: () => 'fine',
};

/** Serves `rootValue` as the resolvers of the SDL schema. */
const withRoot: Plugin = {
  onExecute: ({ args }) => {
    args.rootValue = rootValue;
  },
};

interface Body {
  data?: Record<string, unknown> | null;
  errors?: { message: string; path?: string[]; extensions?: Record<string, unknown> }[];
}

const serve = (mask: boolean) => {
  const yoga = createYoga({
    schema,
    plugins: [manabloxErrorsPlugin({ mask }), withRoot],
    logging: false,
    maskedErrors: mask,
  });
  return async (query: string): Promise<Body> => {
    const response = await yoga.fetch('http://graphql.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return (await response.json()) as Body;
  };
};

describe('manabloxErrorsPlugin', () => {
  it('maps a ManabloxError to its key, kind, status and details', async () => {
    const body = await serve(false)('{ notFound ok }');
    expect(body.data).toEqual({ notFound: null, ok: 'fine' });
    expect(body.errors?.[0]).toMatchObject({
      message: 'content.notFound',
      path: ['notFound'],
      extensions: {
        key: 'content.notFound',
        kind: 'not_found',
        status: 404,
        details: [{ key: 'content.notFound', params: { id: 'x' } }],
      },
    });
  });

  it('keeps the key of an internal ManabloxError but drops its details when masked', async () => {
    const masked = await serve(true)('{ internal }');
    expect(masked.errors?.[0]?.extensions).toMatchObject({
      key: 'internal.error',
      kind: 'internal',
      details: [],
    });
    const open = await serve(false)('{ internal }');
    expect(open.errors?.[0]?.extensions?.details).toEqual([
      { key: 'internal.error', params: { dsn: 'pw' } },
    ]);
  });

  it('maps a schema validation failure to validation.failed', async () => {
    const body = await serve(true)('{ invalid }');
    expect(body.errors?.[0]).toMatchObject({
      message: 'validation.failed',
      extensions: {
        key: 'validation.failed',
        kind: 'validation',
        status: 422,
        details: [expect.objectContaining({ key: 'validation.invalid', path: ['name'] })],
      },
    });
  });

  it('leaves an unexpected error to the server masking', async () => {
    // Yoga attaches the original error in development.
    vi.stubEnv('NODE_ENV', 'production');
    const masked = await serve(true)('{ plain }');
    expect(masked.errors?.[0]?.message).toBe('Unexpected error.');
    expect(JSON.stringify(masked)).not.toContain('db-internal-42');
    const open = await serve(false)('{ plain }');
    expect(open.errors?.[0]?.message).toBe('db-internal-42');
    expect(open.errors?.[0]?.extensions ?? {}).not.toHaveProperty('key');
    vi.unstubAllEnvs();
  });

  it('passes a response without errors through untouched', async () => {
    expect(await serve(true)('{ ok }')).toEqual({ data: { ok: 'fine' } });
  });
});

describe('toGraphQLError', () => {
  it('returns an error without a ManabloxError cause unchanged', () => {
    const error = new GraphQLError('syntax', { extensions: { code: 'X' } });
    expect(toGraphQLError(error)).toBe(error);
  });

  it('keeps path and existing extensions next to the transport fields', () => {
    const error = new GraphQLError('wrapped', {
      path: ['a', 0, 'b'],
      originalError: ManabloxError.forbidden('auth.forbidden'),
      extensions: { trace: 't1' },
    });
    const mapped = toGraphQLError(error);
    expect(mapped.message).toBe('auth.forbidden');
    expect(mapped.path).toEqual(['a', 0, 'b']);
    expect(mapped.extensions).toMatchObject({
      trace: 't1',
      key: 'auth.forbidden',
      kind: 'forbidden',
      status: 403,
    });
  });
});
