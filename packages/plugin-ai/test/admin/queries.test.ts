import { queryClient } from '@manablox/admin-sdk';
import { mockAdminApi } from '@manablox/admin-sdk/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiKeys } from '../../src/admin/keys';
import { aiProviders } from '../../src/admin/queries';

const aiApi = {
  saveProvider: vi.fn(async (input: unknown) => input),
  deleteProvider: vi.fn(async () => ({ ok: true })),
  testProvider: vi.fn(async () => ({ ok: true })),
  saveSettings: vi.fn(async (input: unknown) => input),
};
mockAdminApi({ plugins: { ai: aiApi } });

const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated === true;

describe('aiProviders', () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(aiKeys.providers('space-1'), []);
    queryClient.setQueryData(aiKeys.providers('space-2'), []);
  });

  it("saves and marks that space's AI queries stale", async () => {
    await aiProviders.save({ spaceId: 'space-1', kind: 'openai', enabled: true } as never);
    expect(aiApi.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space-1', kind: 'openai' }),
    );
    expect(invalidated(aiKeys.providers('space-1'))).toBe(true);
    expect(invalidated(aiKeys.providers('space-2'))).toBe(false);
  });

  it('removes by reference and invalidates', async () => {
    await aiProviders.remove('space-1', 'openai');
    expect(aiApi.deleteProvider).toHaveBeenCalledWith({ spaceId: 'space-1', kind: 'openai' });
    expect(invalidated(aiKeys.providers('space-1'))).toBe(true);
  });

  it('tests without invalidating', async () => {
    await aiProviders.test('space-1', 'openai');
    expect(aiApi.testProvider).toHaveBeenCalledWith({ spaceId: 'space-1', kind: 'openai' });
    expect(invalidated(aiKeys.providers('space-1'))).toBe(false);
  });

  it('saves settings and invalidates', async () => {
    await aiProviders.saveSettings({ spaceId: 'space-1', lengths: [] } as never);
    expect(aiApi.saveSettings).toHaveBeenCalledOnce();
    expect(invalidated(aiKeys.providers('space-1'))).toBe(true);
  });

  it('does not invalidate when the write fails', async () => {
    aiApi.deleteProvider.mockRejectedValueOnce(new Error('nope'));
    await expect(aiProviders.remove('space-1', 'openai')).rejects.toThrow('nope');
    expect(invalidated(aiKeys.providers('space-1'))).toBe(false);
  });
});
