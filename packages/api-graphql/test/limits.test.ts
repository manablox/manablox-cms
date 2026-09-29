import { buildSchema as buildSdl } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { describe, expect, it } from 'vitest';
import {
  complexityLimitPlugin,
  depthLimitPlugin,
  disableIntrospectionPlugin,
  persistedOperationsPlugin,
} from '../src/limits.js';

const schema = buildSdl(`
  type Node { id: ID! name: String children(limit: Int): [Node!]! parent: Node }
  type Page { total: Int! items: [Node!]! }
  type Query {
    node: Node
    contentsPage(limit: Int): Page!
  }
`);

const node = (): Record<string, unknown> => ({
  id: '1',
  name: 'n',
  children: [],
  parent: null,
});

const rootValue = {
  node,
  contentsPage: () => ({ total: 1, items: [node()] }),
};

/** Serves `rootValue` as the resolvers of the SDL schema. */
const withRoot: Plugin = {
  onExecute: ({ args }) => {
    args.rootValue = rootValue;
  },
};

interface Body {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
}

const serve = (plugins: Plugin[]) => {
  const yoga = createYoga({
    schema,
    plugins: [...plugins, withRoot],
    logging: false,
    graphiql: false,
    maskedErrors: false,
  });
  return async (payload: Record<string, unknown>): Promise<Body> => {
    const response = await yoga.fetch('http://graphql.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await response.json()) as Body;
  };
};

const code = (body: Body) => body.errors?.[0]?.extensions?.code;
const key = (body: Body) => body.errors?.[0]?.extensions?.key;

describe('depthLimitPlugin', () => {
  // Depth counts fields with a selection set; leaves add none.
  const run = serve([depthLimitPlugin(2)]);

  it('allows a query at the limit and rejects one past it', async () => {
    expect((await run({ query: '{ node { parent { id } } }' })).errors).toBeUndefined();
    const body = await run({ query: '{ node { parent { parent { id } } } }' });
    expect(body.errors?.[0]?.extensions).toMatchObject({
      code: 'QUERY_TOO_DEEP',
      key: 'graphql.query.tooDeep',
      kind: 'bad_request',
      status: 400,
      maxDepth: 2,
      details: [{ key: 'graphql.query.tooDeep', params: { maxDepth: 2 } }],
    });
  });

  it('counts depth through fragment spreads and inline fragments', async () => {
    const spread = await run({
      query:
        'query { node { ...P } } fragment P on Node { parent { ... on Node { parent { id } } } }',
    });
    expect(code(spread)).toBe('QUERY_TOO_DEEP');
  });

  it('rejects a cyclic fragment instead of recursing', async () => {
    const body = await run({
      query: '{ node { ...A } } fragment A on Node { parent { ...B } } fragment B on Node { ...A }',
    });
    expect(body.errors?.map((error) => error.extensions?.code)).toContain('QUERY_TOO_DEEP');
  });

  it('checks every operation in a document', async () => {
    const body = await run({
      query: 'query A { node { id } } query B { node { parent { parent { id } } } }',
      operationName: 'A',
    });
    expect(code(body)).toBe('QUERY_TOO_DEEP');
  });
});

describe('complexityLimitPlugin', () => {
  // `defaultListSize` 10: a list without a literal limit counts ten times.
  const run = serve([complexityLimitPlugin(50, 10)]);

  it('multiplies a subtree by a literal limit', async () => {
    // 1 + 5 * (1 + 2) = 16
    const ok = await run({ query: '{ contentsPage(limit: 5) { items { id name } } }' });
    expect(ok.errors).toBeUndefined();
    // 1 + 30 * (1 + 2) = 91
    const body = await run({ query: '{ contentsPage(limit: 30) { items { id name } } }' });
    expect(body.errors?.[0]?.extensions).toMatchObject({
      code: 'QUERY_TOO_COMPLEX',
      key: 'graphql.query.tooComplex',
      kind: 'bad_request',
      status: 400,
      maxComplexity: 50,
      details: [{ key: 'graphql.query.tooComplex', params: { maxComplexity: 50 } }],
    });
    expect(body.errors?.[0]?.message).toMatch(/maximum complexity of 50 \(estimated 91\)/);
  });

  it('worst-cases a variable limit with the default list size', async () => {
    // 1 + 10 * (1 + 1 + 10 * 1) = 121, whatever the variable holds.
    const body = await run({
      query: 'query($n: Int) { contentsPage(limit: $n) { items { children(limit: $n) { id } } } }',
      variables: { n: 1 },
    });
    expect(code(body)).toBe('QUERY_TOO_COMPLEX');
  });

  it('treats a known list field without a limit as the default list size', async () => {
    // 1 + 10 * (1 + 1 + 10 * 1) = 121
    const body = await run({ query: '{ contentsPage { items { children { id } } } }' });
    expect(code(body)).toBe('QUERY_TOO_COMPLEX');
  });

  it('prices a contentsPage by its limit once, not again for its items', async () => {
    // 1 + 20 * (1 + 1) = 41; sizing `items` again would be 1 + 20 * (1 + 10) = 221.
    const ok = await run({ query: '{ contentsPage(limit: 20) { items { id } } }' });
    expect(ok.errors).toBeUndefined();
  });

  it('counts fragments and rejects a cyclic one', async () => {
    const spread = await run({
      query:
        '{ contentsPage(limit: 20) { items { ...F } } } fragment F on Node { id name parent { id } }',
    });
    expect(code(spread)).toBe('QUERY_TOO_COMPLEX');
    const cyclic = await run({
      query: '{ node { ...A } } fragment A on Node { ...B } fragment B on Node { ...A }',
    });
    expect(cyclic.errors?.map((error) => error.extensions?.code)).toContain('QUERY_TOO_COMPLEX');
  });
});

describe('disableIntrospectionPlugin', () => {
  const run = serve([disableIntrospectionPlugin()]);

  it('refuses __schema and __type but not ordinary fields', async () => {
    const schemaBody = await run({ query: '{ __schema { queryType { name } } }' });
    expect(schemaBody.errors?.[0]?.extensions).toMatchObject({
      code: 'INTROSPECTION_DISABLED',
      key: 'graphql.introspection.disabled',
      kind: 'bad_request',
      status: 400,
    });
    expect(key(await run({ query: '{ __type(name: "Node") { name } }' }))).toBe(
      'graphql.introspection.disabled',
    );
    expect((await run({ query: '{ node { id __typename } }' })).errors).toBeUndefined();
  });
});

describe('persistedOperationsPlugin', () => {
  const manifest = { abc: '{ node { id } }' };

  it('runs a manifest query by documentId or persistedQuery hash', async () => {
    const run = serve([persistedOperationsPlugin({ manifest })]);
    expect(await run({ extensions: { documentId: 'abc' } })).toEqual({
      data: { node: { id: '1' } },
    });
    expect(
      await run({ extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } }),
    ).toEqual({ data: { node: { id: '1' } } });
  });

  it('rejects raw query text and unknown hashes by default', async () => {
    const unknown: (string | null)[] = [];
    const run = serve([
      persistedOperationsPlugin({ manifest, onUnknown: (hash) => unknown.push(hash) }),
    ]);
    expect((await run({ query: '{ node { id } }' })).errors?.[0]?.extensions).toMatchObject({
      code: 'PERSISTED_QUERY_REQUIRED',
      key: 'graphql.persisted.required',
      kind: 'bad_request',
      status: 400,
    });
    const unknownBody = await run({ extensions: { documentId: 'nope' } });
    expect(code(unknownBody)).toBe('PERSISTED_QUERY_NOT_FOUND');
    expect(key(unknownBody)).toBe('graphql.persisted.notFound');
    expect(unknown).toEqual(['nope']);
  });

  it('answers 400 whatever the client accepts', async () => {
    const yoga = createYoga({ schema, plugins: [persistedOperationsPlugin({ manifest })] });
    for (const accept of ['application/json', 'application/graphql-response+json']) {
      const response = await yoga.fetch('http://graphql.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept },
        body: JSON.stringify({ query: '{ node { id } }' }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('lets raw queries and unknown hashes through when not rejecting, still reporting them', async () => {
    const unknown: (string | null)[] = [];
    const run = serve([
      persistedOperationsPlugin({
        manifest,
        rejectUnknown: false,
        onUnknown: (hash) => unknown.push(hash),
      }),
    ]);
    expect((await run({ query: '{ node { name } }' })).data).toEqual({ node: { name: 'n' } });
    const fallback = await run({
      query: '{ node { name } }',
      extensions: { documentId: 'stale' },
    });
    expect(fallback.data).toEqual({ node: { name: 'n' } });
    expect(unknown).toEqual(['stale']);
  });
});
