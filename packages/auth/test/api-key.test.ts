import { DefaultControls, ManabloxError, resolveAll } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { describe, expect, it } from 'vitest';
import { ApiKeyService, parseApiKey } from '../src/api-key.js';

describe('parseApiKey', () => {
  it('keeps a secret that itself contains the separator', () => {
    expect(parseApiKey('mbx_0123456789ab_ab_cd-ef_gh')).toEqual({
      prefix: '0123456789ab',
      secret: 'ab_cd-ef_gh',
    });
  });

  it('refuses another prefix, a malformed lookup part, or an empty secret', () => {
    expect(parseApiKey('abc_0123456789ab_secret')).toBeNull();
    expect(parseApiKey('mbx_0123_secret')).toBeNull();
    expect(parseApiKey('mbx_0123456789ab_')).toBeNull();
    expect(parseApiKey('not a key')).toBeNull();
  });
});

describe('apiKey:beforeIssue', () => {
  it('refuses a key before anything is stored', async () => {
    const manablox = new Manablox({
      database: { url: 'postgres://unused/unused' },
      auth: { secret: 'test-secret' },
    });
    const stored: unknown[] = [];
    const repos = {
      apiKeys: { create: async (row: unknown) => stored.push(row) },
      audit: { record: async () => {} },
    } as unknown as Repositories;
    const seen: unknown[] = [];
    manablox.hooks.on('apiKey:beforeIssue', (payload) => {
      seen.push(payload);
      throw ManabloxError.forbidden('auth.forbidden');
    });

    const keys = new ApiKeyService(repos, undefined, manablox);
    await expect(keys.issue('u1', 'Build', { spaceIds: ['s1'] })).rejects.toMatchObject({
      key: 'auth.forbidden',
    });
    expect(seen).toEqual([
      { userId: 'u1', name: 'Build', spaceIds: ['s1'], permissions: null, expiresAt: null },
    ]);
    expect(stored).toEqual([]);
  });
});

describe('apiKeysDisable', () => {
  it('refuses every key before the lookup while set', async () => {
    const manablox = new Manablox({
      database: { url: 'postgres://unused/unused' },
      auth: { secret: 'test-secret' },
    });
    const lookups: string[] = [];
    const repos = {
      apiKeys: {
        findEnabledByPrefix: async (prefix: string) => {
          lookups.push(prefix);
          return null;
        },
      },
    } as unknown as Repositories;
    const disabled = resolveAll([
      { scope: { kind: 'instance' }, values: { apiKeysDisable: true } },
    ]);
    const base = new DefaultControls();
    manablox.setControls(
      Object.assign(Object.create(base), { resolved: async () => disabled }) as DefaultControls,
    );

    const keys = new ApiKeyService(repos, undefined, manablox);
    expect(await keys.resolve('mbx_0123456789ab_secret')).toBeNull();
    expect(lookups).toEqual([]);

    manablox.setControls(base);
    await keys.resolve('mbx_0123456789ab_secret');
    expect(lookups).toEqual(['0123456789ab']);
  });
});

describe('apiKeys limit', () => {
  it('checks the instance limit before a key is stored', async () => {
    const manablox = new Manablox({
      database: { url: 'postgres://unused/unused' },
      auth: { secret: 'test-secret' },
    });
    const stored: unknown[] = [];
    const repos = {
      apiKeys: { create: async (row: unknown) => stored.push(row) },
      audit: { record: async () => {} },
    } as unknown as Repositories;
    const checks: unknown[] = [];
    manablox.setControls(
      Object.assign(Object.create(new DefaultControls()), {
        assertLimit: async (spaceId: string | null, key: string) => {
          checks.push([spaceId, key]);
          throw ManabloxError.conflict('control.limit', { limit: key });
        },
      }) as DefaultControls,
    );

    const keys = new ApiKeyService(repos, undefined, manablox);
    await expect(keys.issue('u1', 'Build', { spaceIds: ['s1'] })).rejects.toMatchObject({
      key: 'control.limit',
    });
    expect(checks).toEqual([[null, 'apiKeys']]);
    expect(stored).toEqual([]);
  });
});
