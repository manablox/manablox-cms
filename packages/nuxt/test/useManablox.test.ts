import { beforeEach, describe, expect, it } from 'vitest';
import { useManablox } from '../src/runtime/composables/useManablox.js';
import { nuxt } from './helpers/nuxt-imports.js';

describe('useManablox', () => {
  beforeEach(() => {
    nuxt.app = {};
    delete nuxt.config.cache;
  });

  it('returns the same client within one app', () => {
    expect(useManablox()).toBe(useManablox());
  });

  it('gives every app, so every server request, its own client', () => {
    const first = useManablox();
    nuxt.app = {};
    expect(useManablox()).not.toBe(first);
  });

  it('passes the cache option to the client', () => {
    nuxt.config.cache = false;
    const client = useManablox() as unknown as { cache: unknown };
    expect(client.cache).toBeNull();
  });
});
