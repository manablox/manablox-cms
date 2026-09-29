import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  api,
  pluginClient,
  queryClient,
  useCan,
  usePluginApi,
  useSessionStore,
  useSpaceStore,
} from '../src/index';
import {
  createTestSession,
  exposePluginApi,
  mockAdminApi,
  resetAdminApi,
  setupAdminTest,
  testMe,
  useTestSpace,
} from '../src/testing';

// Made at module load, as a plugin's `queries.ts` does, before any test mocks the API.
const seo = pluginClient<never>('acme.seo') as unknown as {
  reports: { list: (input: unknown) => Promise<unknown> };
};

beforeEach(() => setupAdminTest());

describe('mockAdminApi', () => {
  it("answers the core's and a plugin's procedures, clients made earlier included", async () => {
    const list = vi.fn(async () => [{ id: 'r1' }]);
    const spaces = vi.fn(async () => []);
    mockAdminApi({ spaces: { list: spaces }, plugins: { 'acme.seo': { reports: { list } } } });
    expect(await seo.reports.list({ spaceId: 's1' })).toEqual([{ id: 'r1' }]);
    expect(list).toHaveBeenCalledWith({ spaceId: 's1' });
    expect(await api.spaces.list()).toEqual([]);
  });

  it('rejects a procedure it was not given, naming it', async () => {
    mockAdminApi({});
    await expect(api.contentTypes.list({ spaceId: 's1' })).rejects.toThrow(
      'admin API: contentTypes.list is not mocked',
    );
    await expect(seo.reports.list({})).rejects.toThrow('plugins.acme.seo.reports.list');
  });

  it('is never mistaken for a promise', () => {
    mockAdminApi({});
    expect((api as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('hands the real client back on reset', () => {
    const list = vi.fn();
    mockAdminApi({ plugins: { 'acme.seo': { reports: { list } } } });
    expect(seo.reports.list).toBe(list);
    resetAdminApi();
    expect(seo.reports.list).not.toBe(list);
  });
});

describe('createTestSession', () => {
  it('signs an editor in with the permissions given', () => {
    const me = createTestSession({ permissions: { s1: ['content:read'] } });
    const session = useSessionStore();
    expect(session.me).toEqual(me);
    expect(me).toMatchObject({ role: 'editor', email: 'editor@example.com' });
    expect(session.can('content:read', 's1')).toBe(true);
    expect(session.can('content:write', 's1')).toBe(false);
  });

  it('switches features off, with a lock or hidden', () => {
    createTestSession(
      { role: 'superadmin' },
      { locked: ['plugins.seo'], hidden: ['menus'], message: 'Add a license key.' },
    );
    const session = useSessionStore();
    expect(session.feature('plugins.seo' as never, 's1')).toMatchObject({
      enabled: false,
      locked: true,
      message: 'Add a license key.',
    });
    expect(session.feature('menus', null)).toMatchObject({ enabled: false, hidden: true });
    expect(session.feature('tags', 's1').enabled).toBe(true);
  });

  it('builds the account alone with testMe', () => {
    expect(testMe({ id: 'u2' }).id).toBe('u2');
    expect(useSessionStore().me).toBeNull();
  });
});

describe('useTestSpace', () => {
  it('makes the space current, its types readable after a tick, fetching nothing', async () => {
    const list = vi.fn(async () => []);
    mockAdminApi({ contentTypes: { list, fieldTypes: list } });
    const types = [{ id: 't1', name: 'page', kind: 'content', fields: [] }] as never;
    const store = useTestSpace({ id: 's1', locales: ['en', 'de'] }, { contentTypes: types });
    expect(store).toBe(useSpaceStore());
    expect(store.currentId).toBe('s1');
    expect(store.current).toMatchObject({ id: 's1', locales: ['en', 'de'], defaultLocale: 'en' });
    await nextTick();
    expect(store.contentTypes.map((type) => type.id)).toEqual(['t1']);
    expect(list).not.toHaveBeenCalled();
  });

  it('gates useCan by the session in that space', () => {
    useTestSpace({ id: 's1' });
    createTestSession({ permissions: { s1: ['seo:write'] } });
    expect(useCan('seo:write').value).toBe(true);
    expect(useCan('seo:admin').value).toBe(false);
  });
});

describe('setupAdminTest', () => {
  it('starts each test with a fresh store, cache and plugin apis', () => {
    exposePluginApi('ai', { wand: true });
    queryClient.setQueryData(['x'], 1);
    useSessionStore().me = testMe();
    setupAdminTest();
    expect(usePluginApi('ai')).toBeUndefined();
    expect(queryClient.getQueryData(['x'])).toBeUndefined();
    expect(useSessionStore().me).toBeNull();
  });

  it('sets up the api, the account and the space in one call', async () => {
    const list = vi.fn(async () => ['r']);
    setupAdminTest({
      api: { plugins: { 'acme.seo': { reports: { list } } } },
      me: { role: 'superadmin' },
      space: { id: 's9' },
    });
    expect(useSessionStore().me?.role).toBe('superadmin');
    expect(useSpaceStore().currentId).toBe('s9');
    expect(await seo.reports.list({})).toEqual(['r']);
  });
});
