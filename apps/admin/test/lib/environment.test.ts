import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));

import {
  environmentHeaders,
  environmentOf,
  setEnvironment,
  syncEnvironment,
} from '@manablox/admin-sdk/lib/environment';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';

const route = (query: Record<string, string>, meta: Record<string, unknown> = {}) =>
  ({ path: '/content', query, hash: '', meta }) as unknown as RouteLocationNormalized;

const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated ?? null;

beforeEach(() => {
  setEnvironment(null, null);
  queryClient.clear();
});

describe('the working environment', () => {
  it('is production until one is set, and only for the space it was set in', () => {
    expect(environmentOf('s1')).toBe('production');
    setEnvironment('s1', 'staging');
    expect(environmentOf('s1')).toBe('staging');
    expect(environmentOf('s2')).toBe('production');
    expect(environmentOf(null)).toBe('production');
    setEnvironment('s1', 'production');
    expect(environmentOf('s1')).toBe('production');
  });

  it("adopts the URL's ?env=", () => {
    expect(syncEnvironment(route({ env: 'staging' }), 's1')).toBe(true);
    expect(environmentOf('s1')).toBe('staging');
  });

  it('puts ?env= back on a navigation that dropped it', () => {
    setEnvironment('s1', 'staging');
    expect(syncEnvironment(route({ tab: 'general' }), 's1')).toEqual({
      path: '/content',
      query: { tab: 'general', env: 'staging' },
      hash: '',
    });
  });

  it('leaves production and public pages alone', () => {
    expect(syncEnvironment(route({}), 's1')).toBe(true);
    setEnvironment('s1', 'staging');
    expect(syncEnvironment(route({}, { public: true }), 's1')).toBe(true);
  });

  it('sends the header only for calls of the active space', () => {
    expect(environmentHeaders({ spaceId: 's1' })).toEqual({});
    setEnvironment('s1', 'staging');
    expect(environmentHeaders({ spaceId: 's1' })).toEqual({ 'x-manablox-environment': 'staging' });
    expect(environmentHeaders({ filter: { spaceId: 's1' } })).toEqual({
      'x-manablox-environment': 'staging',
    });
    expect(environmentHeaders({ spaceId: 's2' })).toEqual({});
    expect(environmentHeaders(undefined)).toEqual({});
  });
});

describe('query keys per environment', () => {
  it('carry the environment, so a switch reads other keys', () => {
    const key = computed(() => keys.content.tree('s1', 'en'));
    const production = key.value;
    setEnvironment('s1', 'staging');
    expect(key.value).not.toEqual(production);
    expect(key.value).toContain('staging');
    expect(keys.contentTypes.list('s1')).toContain('staging');
    expect(keys.spaces.apiHosts('s1')).toContain('staging');
  });

  it('leave shared data without one', () => {
    setEnvironment('s1', 'staging');
    expect(keys.roles.all('s1')).not.toContain('staging');
    expect(keys.assets.limits('s1')).not.toContain('staging');
    expect(keys.credentials.list('s1')).not.toContain('staging');
  });

  it("invalidate every environment's keys of the space", () => {
    const production = keys.content.recent('s1', 'en');
    const productionHosts = keys.spaces.apiHosts('s1');
    setEnvironment('s1', 'staging');
    const staging = keys.content.recent('s1', 'en');
    const stagingHosts = keys.spaces.apiHosts('s1');
    for (const key of [production, staging, productionHosts, stagingHosts])
      queryClient.setQueryData(key, {});
    invalidate.content('s1');
    invalidate.apiHosts('s1');
    for (const key of [production, staging, productionHosts, stagingHosts])
      expect(invalidated(key)).toBe(true);
  });
});
