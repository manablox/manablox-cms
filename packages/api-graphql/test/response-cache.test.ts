import { describe, expect, it } from 'vitest';
import { graphqlCacheKey } from '../src/index.js';

const scope = { spaceId: 's', environmentId: 'e', machineName: 'production', production: true };
const limits = { maxDepth: 8, maxComplexity: 1000 };

describe('graphqlCacheKey', () => {
  it('ignores whitespace and variable order', () => {
    expect(graphqlCacheKey('s', scope, { query: '{ a }', variables: { x: 1, y: 2 } }, limits)).toBe(
      graphqlCacheKey('s', scope, { query: ' {  a } ', variables: { y: 2, x: 1 } }, limits),
    );
  });

  it('keeps operations, limits, spaces and staging apart', () => {
    const base = graphqlCacheKey('s', scope, { query: '{ a }' }, limits);
    expect(graphqlCacheKey('s', scope, { query: '{ a }', operationName: 'A' }, limits)).not.toBe(
      base,
    );
    expect(graphqlCacheKey('s', scope, { query: '{ a }' }, { ...limits, maxDepth: 4 })).not.toBe(
      base,
    );
    expect(graphqlCacheKey('t', scope, { query: '{ a }' }, limits)).not.toBe(base);
    const staging = { ...scope, environmentId: 'st', machineName: 'staging', production: false };
    expect(graphqlCacheKey('s', staging, { query: '{ a }' }, limits)).not.toBe(base);
  });
});
