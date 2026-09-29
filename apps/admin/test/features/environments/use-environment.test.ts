import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const store = vi.hoisted(() => ({ value: null as null | { currentId: string | null } }));
const list = vi.hoisted(() => ({ value: null as null | { value: unknown } }));

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => store.value }));
vi.mock('@manablox/admin-sdk/features/environments/queries', () => ({
  useEnvironments: () => ({ data: list.value, isPending: ref(false), error: ref(null) }),
}));

import {
  useEnvironment,
  useEnvironmentSync,
} from '@manablox/admin-sdk/features/environments/useEnvironment';
import {
  environmentOf,
  setEnvironment,
  syncEnvironment,
} from '@manablox/admin-sdk/lib/environment';

const rows = (...names: string[]) =>
  names.map((machineName) => ({
    id: `id-${machineName}`,
    machineName,
    name: machineName,
    kind: machineName === 'production' ? 'production' : 'staging',
  }));

let router: Router;

function makeRouter(): Router {
  const page = defineComponent({ render: () => h('div') });
  const next = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: page },
      { path: '/content', component: page, meta: { section: '/content' } },
      { path: '/content/:id', component: page, meta: { section: '/content', editor: 'edit' } },
      { path: '/login', component: page, meta: { public: true } },
    ],
  });
  next.beforeEach((to) => syncEnvironment(to, store.value?.currentId ?? null));
  return next;
}

/** Mounts `setup` under the router; returns what it returned. */
async function within<T>(setup: () => T): Promise<T> {
  let result!: T;
  mount(
    defineComponent({
      setup() {
        result = setup();
        return () => h('div');
      },
    }),
    { global: { plugins: [router] } },
  );
  await flushPromises();
  return result;
}

beforeEach(async () => {
  setActivePinia(createPinia());
  setEnvironment(null, null);
  store.value = reactive({ currentId: 's1' });
  list.value = ref(rows('production', 'staging'));
  router = makeRouter();
  await router.push('/content/doc-1');
});

describe('useEnvironment', () => {
  it('is production without ?env=', async () => {
    const environment = await within(useEnvironment);
    expect(environment.machineName.value).toBe('production');
    expect(environment.production.value).toBe(true);
  });

  it("follows the URL's ?env= and keeps it across navigation", async () => {
    await router.push('/content?env=staging');
    const environment = await within(useEnvironment);
    expect(environment.machineName.value).toBe('staging');
    expect(environment.current.value?.id).toBe('id-staging');
    await router.push('/content/doc-2');
    expect(router.currentRoute.value.query.env).toBe('staging');
    expect(router.currentRoute.value.path).toBe('/content/doc-2');
  });

  it("switches to an editor's section and back to production", async () => {
    const environment = await within(useEnvironment);
    await environment.switchTo('staging');
    expect(router.currentRoute.value.fullPath).toBe('/content?env=staging');
    expect(environmentOf('s1')).toBe('staging');
    await environment.switchTo('production');
    expect(router.currentRoute.value.fullPath).toBe('/content');
    expect(environmentOf('s1')).toBe('production');
  });
});

describe('useEnvironmentSync', () => {
  it('goes back to production when the space changes', async () => {
    await router.push('/content?env=staging');
    await within(useEnvironmentSync);
    expect(environmentOf('s1')).toBe('staging');
    (store.value as { currentId: string }).currentId = 's2';
    await flushPromises();
    expect(environmentOf('s2')).toBe('production');
    expect(router.currentRoute.value.query.env).toBeUndefined();
  });

  it('falls back to production for an environment the space does not have', async () => {
    await router.push('/content?env=gone');
    await within(useEnvironmentSync);
    await flushPromises();
    expect(environmentOf('s1')).toBe('production');
    expect(router.currentRoute.value.fullPath).toBe('/content');
  });

  it('learns the environment id once the list is loaded', async () => {
    await router.push('/content?env=staging');
    list.value = ref(undefined);
    await within(useEnvironmentSync);
    expect(environmentOf('s1')).toBe('staging');
    (list.value as { value: unknown }).value = rows('production', 'staging');
    await flushPromises();
    const { activeEnvironment } = await import('@manablox/admin-sdk/lib/environment');
    expect(activeEnvironment.value?.id).toBe('id-staging');
  });
});
