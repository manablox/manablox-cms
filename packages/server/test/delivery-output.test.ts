import type { ManabloxConfig } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const PAGE = {
  name: 'page',
  fields: [
    { name: 'summary', type: 'string' },
    { name: 'hero', type: 'asset' },
    { name: 'author', type: 'user' },
    {
      name: 'latest',
      type: 'content',
      settings: { multiple: true, selection: 'filter', limit: 3 },
    },
  ],
};

const build = async () => {
  const { runtime } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
    cache: { enabled: false },
    contentTypes: [PAGE],
  } as Partial<ManabloxConfig>);
  await initialised(runtime);
  return createApp(runtime);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const PATHS = [
  '/v1/content?limit=5&expand=hero,author,latest',
  `/v1/content/${ids.doc}?expand=hero`,
  '/v1/permalink/about',
  '/v1/menus/main',
  '/v1/types',
];

describe('public REST output validation', () => {
  it('answers production, which skips it, exactly as the validating build', async () => {
    const validating = await build();
    vi.stubEnv('NODE_ENV', 'production');
    const production = await build();
    for (const path of PATHS) {
      const request = () => new Request(`http://public.test${path}`);
      const checked = await validating.request(request());
      const unchecked = await production.request(request());
      expect(checked.status, path).toBe(200);
      expect(unchecked.status, path).toBe(checked.status);
      expect(await unchecked.json(), path).toEqual(await checked.json());
    }
  });
});
