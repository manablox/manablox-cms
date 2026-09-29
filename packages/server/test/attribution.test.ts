import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const build = async (config: Record<string, unknown> = {}) => {
  const { runtime } = stubRuntime(config);
  await initialised(runtime);
  return createApp(runtime);
};

describe('the x-powered-by header', () => {
  it('is on management responses', async () => {
    const app = await build();
    const res = await app.request(new Request('http://admin.test/healthz'));
    expect(res.headers.get('x-powered-by')).toBe('Manablox');
  });

  it('is on public responses', async () => {
    const app = await build({
      server: { mode: 'public' },
      publicApi: { spaceId: ids.space },
    });
    const res = await app.request(new Request('http://public.test/'));
    expect(res.headers.get('x-powered-by')).toBe('Manablox');
  });

  it('survives an error response, which no other middleware writes', async () => {
    const app = await build();
    const res = await app.request(new Request('http://admin.test/nothing-here'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-powered-by')).toBe('Manablox');
  });

  it('names Manablox in the public service document', async () => {
    const app = await build({
      server: { mode: 'public' },
      publicApi: { spaceId: ids.space },
    });
    const body = (await (await app.request(new Request('http://public.test/'))).json()) as {
      name: string;
    };
    expect(body.name).toContain('Manablox');
  });
});
