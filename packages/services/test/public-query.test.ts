import type { ContentTypeRegistry } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { PUBLIC_LIST_MAX_LIMIT, toPublicListQuery } from '../src/public-query.js';

const registry = {} as ContentTypeRegistry;
const defaults = { spaceId: 's1', locale: 'en' };

describe('toPublicListQuery pagination', () => {
  it('defaults and passes valid values through', () => {
    expect(toPublicListQuery(registry, {}, defaults).pagination).toEqual({ limit: 25, offset: 0 });
    expect(
      toPublicListQuery(registry, { limit: PUBLIC_LIST_MAX_LIMIT, offset: 3 }, defaults).pagination,
    ).toEqual({ limit: PUBLIC_LIST_MAX_LIMIT, offset: 3 });
  });

  it('refuses a limit above the shared maximum', () => {
    expect(() =>
      toPublicListQuery(registry, { limit: PUBLIC_LIST_MAX_LIMIT + 1 }, defaults),
    ).toThrow(expect.objectContaining({ key: 'query.limit.invalid' }));
  });

  it('refuses a limit below one and a negative offset', () => {
    expect(() => toPublicListQuery(registry, { limit: -1 }, defaults)).toThrow(
      expect.objectContaining({ key: 'query.limit.invalid' }),
    );
    expect(() => toPublicListQuery(registry, { limit: 0 }, defaults)).toThrow(
      expect.objectContaining({ key: 'query.limit.invalid' }),
    );
    expect(() => toPublicListQuery(registry, { offset: -5 }, defaults)).toThrow(
      expect.objectContaining({ key: 'query.offset.invalid' }),
    );
  });
});
