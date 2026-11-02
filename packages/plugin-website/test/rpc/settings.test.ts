import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { failure, invoke, principal } from '../helpers/rpc.js';
import { pluginContext, website } from '../helpers/website-rpc.js';

const hash = '$argon2id$v=19$m=19456,t=2,p=1$abc$def';
const stored = {
  mode: 'designed',
  revision: 1,
  localeStrategy: 'prefix',
  notFoundContentId: null,
  password: hash,
};

function settingsContext(role = 'owner') {
  const settings = {
    get: vi.fn(async (_scope: unknown) => stored),
    set: vi.fn(async (_scope: unknown, _input: unknown) => stored),
  };
  const ctx = pluginContext(
    {
      settings,
      config: { url: 'https://sites.test', forms: { secret: 'forms-secret-0123456789' } },
    },
    principal({ spaces: { [ids.space]: role } }),
  );
  return { ctx, settings };
}

describe('plugins.website.settings', () => {
  it('hashes a new password, clears with null and never returns the hash', async () => {
    const { ctx, settings } = settingsContext();
    const result = await invoke<Record<string, unknown>>(
      website.settings.set,
      { spaceId: ids.space, password: 'open sesame' },
      ctx,
    );
    const input = settings.set.mock.calls[0]?.[1] as { passwordHash?: string } | undefined;
    expect(input?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(result).toMatchObject({ mode: 'designed', hasPassword: true });
    expect(JSON.stringify(result)).not.toContain('argon2');

    await invoke(website.settings.set, { spaceId: ids.space, password: null }, ctx);
    expect(settings.set.mock.calls[1]?.[1]).toEqual({ passwordHash: null });
    await invoke(website.settings.set, { spaceId: ids.space, localeStrategy: 'domain' }, ctx);
    expect(settings.set.mock.calls[2]?.[1]).toEqual({ localeStrategy: 'domain' });

    expect(
      await failure(invoke(website.settings.set, { spaceId: ids.space, password: 'short' }, ctx)),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('reports whether a password is set without the hash, with the site origin', async () => {
    const { ctx } = settingsContext('viewer');
    const result = await invoke<Record<string, unknown>>(
      website.settings.get,
      { spaceId: ids.space },
      ctx,
    );
    expect(result).toMatchObject({
      hasPassword: true,
      siteUrl: 'https://sites.test',
      formsEnabled: true,
    });
    expect(result).not.toHaveProperty('password');
    expect(
      await failure(invoke(website.settings.set, { spaceId: ids.space, mode: 'external' }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});
