import type { AdminPlugin, ComponentLoader } from '@manablox/admin-plugin';
import SdkPluginSlot from '@manablox/admin-sdk/components/PluginSlot.vue';
import { SDK_API_LEVEL } from '@manablox/admin-sdk/lib/api-level';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { usePluginApi } from '@manablox/admin-sdk/lib/plugin-slots';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { RealtimeEvent } from '@manablox/core';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import PluginSlot from '~/components/PluginSlot';
import { installAdminPlugin, SHELL_ROUTE } from '~/features/plugins/install';
import {
  compatibleSdk,
  type LoaderDeps,
  loadRuntimePlugins,
  type RuntimePluginEntry,
  SUPPORTED_SDK_LEVELS,
} from '~/features/plugins/loader';
import {
  dispatchRealtime,
  pluginActionLabel,
  pluginEntityLabel,
  pluginEntityRoute,
  pluginOutcome,
  pluginPermissionIcon,
  pluginSettingsSections,
  pluginSidePanel,
  pluginTransferSections,
  pluginUsageMetric,
  pluginVerb,
  registerSlot,
  resetPluginRegistry,
  type SlotItem,
  slotItems,
  useSlotItems,
} from '~/lib/plugins/registry';
import { meWithControls } from '../controls-fixture';

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));

const text =
  (label: string): ComponentLoader =>
  async () => ({
    default: defineComponent({
      props: { space: { type: Object, default: null } },
      setup: (props) => () =>
        h('p', `${label}${props.space ? ` ${(props.space as { name: string }).name}` : ''}`),
    }),
  });

function entry(id: string, patch: Partial<RuntimePluginEntry> = {}): RuntimePluginEntry {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `/admin/plugins/${id}/h/entry.js`,
    css: [`/admin/plugins/${id}/h/style.css`],
    feature: `plugins.${id}`,
    sdkLevel: 1,
    ...patch,
  };
}

function deps(
  entries: RuntimePluginEntry[],
  modules: Record<string, () => Promise<{ default?: unknown }>>,
): LoaderDeps & { sheets: string[] } {
  const sheets: string[] = [];
  return {
    sheets,
    fetchManifest: async () => ({ plugins: entries }),
    sharedIntact: async () => true,
    importEntry: (url) => modules[url]?.() ?? Promise.reject(new Error(`no module ${url}`)),
    addStylesheet(url) {
      sheets.push(url);
      return () => sheets.splice(sheets.indexOf(url), 1);
    },
    sdkLevels: { min: 1, current: 1 },
  };
}

describe('compatibleSdk', () => {
  it('accepts a level within the supported range and refuses others', () => {
    const levels = { min: 2, current: 3 };
    expect(compatibleSdk(2, levels)).toBe(true);
    expect(compatibleSdk(3, levels)).toBe(true);
    expect(compatibleSdk(1, levels)).toBe(false);
    expect(compatibleSdk(4, levels)).toBe(false);
    expect(compatibleSdk(2.5, levels)).toBe(false);
    expect(compatibleSdk('2', levels)).toBe(false);
  });

  it('supports the SDK level this admin ships', () => {
    expect(compatibleSdk(SDK_API_LEVEL, SUPPORTED_SDK_LEVELS)).toBe(true);
    expect(SUPPORTED_SDK_LEVELS).toEqual({ min: 1, current: 1 });
  });
});

describe('loadRuntimePlugins', () => {
  it('imports every bundle and adds its stylesheets', async () => {
    const d = deps([entry('hello'), entry('seo')], {
      '/admin/plugins/hello/h/entry.js': async () => ({ default: { name: 'hello' } }),
      '/admin/plugins/seo/h/entry.js': async () => ({ default: { name: 'seo' } }),
    });
    const { plugins, failures } = await loadRuntimePlugins(d);
    expect(plugins.map((loaded) => loaded.plugin.name)).toEqual(['hello', 'seo']);
    expect(failures).toEqual([]);
    expect(d.sheets).toHaveLength(2);
  });

  it('skips a bundle that fails to import, keeps the others and drops its stylesheet', async () => {
    const d = deps([entry('broken'), entry('hello')], {
      '/admin/plugins/broken/h/entry.js': async () => {
        throw new Error('SyntaxError in entry');
      },
      '/admin/plugins/hello/h/entry.js': async () => ({ default: { name: 'hello' } }),
    });
    const { plugins, failures } = await loadRuntimePlugins(d);
    expect(plugins.map((loaded) => loaded.entry.id)).toEqual(['hello']);
    expect(failures).toEqual([{ id: 'broken', message: 'SyntaxError in entry' }]);
    expect(d.sheets).toEqual(['/admin/plugins/hello/h/style.css']);
  });

  it('refuses a bundle outside the supported SDK levels without importing it', async () => {
    const importEntry = vi.fn();
    const d = {
      ...deps([entry('new', { sdkLevel: 3 }), entry('old', { sdkLevel: 0 })], {}),
      importEntry,
    };
    const { plugins, failures } = await loadRuntimePlugins(d);
    expect(plugins).toEqual([]);
    expect(failures).toEqual([
      {
        id: 'new',
        message: 'needs admin SDK level 3, this admin supports level 1; update Manablox',
      },
      {
        id: 'old',
        message: 'needs admin SDK level 0, this admin supports level 1; update the plugin',
      },
    ]);
    expect(importEntry).not.toHaveBeenCalled();
  });

  it('refuses an entry that exports no admin plugin', async () => {
    const d = deps([entry('odd')], {
      '/admin/plugins/odd/h/entry.js': async () => ({ default: 42 }),
    });
    const { failures } = await loadRuntimePlugins(d);
    expect(failures[0]).toMatchObject({
      id: 'odd',
      message: expect.stringMatching(/no admin plugin/),
    });
  });

  it("hands out nothing when the shared modules are not the admin's own", async () => {
    const d = {
      ...deps([entry('hello')], {
        '/admin/plugins/hello/h/entry.js': async () => ({ default: { name: 'hello' } }),
      }),
      sharedIntact: async () => false,
    };
    const onLoaded = vi.fn();
    const { plugins, failures } = await loadRuntimePlugins(d, onLoaded);
    expect(plugins).toEqual([]);
    expect(failures).toEqual([{ id: 'admin', message: expect.stringMatching(/single instances/) }]);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(d.sheets).toEqual([]);
  });

  it('imports the entries while the shared modules are checked', async () => {
    let settle: (intact: boolean) => void = () => {};
    const importEntry = vi.fn(async () => ({ default: { name: 'hello' } }));
    const d = {
      ...deps([entry('hello')], {}),
      importEntry,
      sharedIntact: () => new Promise<boolean>((resolve) => (settle = resolve)),
    };
    const loading = loadRuntimePlugins(d);
    await Promise.resolve();
    expect(importEntry).toHaveBeenCalledWith('/admin/plugins/hello/h/entry.js');
    settle(true);
    expect((await loading).plugins.map((loaded) => loaded.entry.id)).toEqual(['hello']);
  });

  it('hands each plugin over in the list order as soon as the ones before it settled', async () => {
    let finishFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => (finishFirst = resolve));
    const d = deps([entry('slow'), entry('broken'), entry('fast')], {
      '/admin/plugins/slow/h/entry.js': async () => {
        await first;
        return { default: { name: 'slow' } };
      },
      '/admin/plugins/fast/h/entry.js': async () => ({ default: { name: 'fast' } }),
    });
    const handed: string[] = [];
    const loading = loadRuntimePlugins(d, (loaded) => handed.push(loaded.entry.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handed).toEqual([]);
    finishFirst();
    const { failures } = await loading;
    expect(handed).toEqual(['slow', 'fast']);
    expect(failures.map((failure) => failure.id)).toEqual(['broken']);
  });

  it('checks nothing when the server lists no bundle', async () => {
    const sharedIntact = vi.fn(async () => true);
    const d = { ...deps([], {}), sharedIntact };
    expect(await loadRuntimePlugins(d)).toEqual({ plugins: [], failures: [] });
    expect(sharedIntact).not.toHaveBeenCalled();
  });

  it('reports an unreachable manifest and loads nothing', async () => {
    const d = {
      ...deps([], {}),
      fetchManifest: async () => {
        throw new Error('offline');
      },
    };
    expect(await loadRuntimePlugins(d)).toEqual({
      plugins: [],
      failures: [{ id: 'manifest', message: 'offline' }],
    });
  });

  it('loads nothing when the server lists no plugins', async () => {
    const d = { ...deps([], {}), fetchManifest: async () => null };
    expect(await loadRuntimePlugins(d)).toEqual({ plugins: [], failures: [] });
  });
});

describe('slot registry', () => {
  beforeEach(() => {
    resetPluginRegistry();
    setActivePinia(createPinia());
    useSessionStore().me = meWithControls();
    useSpaceStore().currentId = 's1';
  });

  const owner = { id: 'hello', feature: 'plugins.hello' };

  it('orders entries and replaces one registered again under its key', () => {
    registerSlot(owner, 'usage.lines', { key: 'b', component: text('B'), order: 200 });
    registerSlot(owner, 'usage.lines', { key: 'a', component: text('A'), order: 50 });
    registerSlot(owner, 'usage.lines', { key: 'b', component: text('B2'), order: 10 });
    expect(slotItems('usage.lines').map((item) => item.key)).toEqual(['hello.b', 'hello.a']);
  });

  it('renders the entries the viewer may see, with the slot props', async () => {
    const space = { id: 's1', name: 'Blog' };
    registerSlot(owner, 'space.settings.sections', { component: text('Shown') });
    // `menus` is hidden in s1.
    registerSlot(owner, 'space.settings.sections', { component: text('Off'), feature: 'menus' });
    registerSlot(owner, 'space.settings.sections', {
      component: text('Forbidden'),
      permission: 'hello:write',
    });
    const wrapper = mount(PluginSlot, {
      props: { id: 'space.settings.sections', props: { space: space as never } },
    });
    await flushPromises();
    expect(wrapper.text()).toBe('Shown Blog');
  });

  it('hands its items to a default slot instead', async () => {
    registerSlot(owner, 'content.editor.views', {
      key: 'canvas',
      label: 'Canvas',
      component: text('C'),
    });
    const wrapper = mount(PluginSlot, {
      props: { id: 'content.editor.views' },
      slots: {
        default: ({ items }: { items: readonly SlotItem[] }) =>
          items.map((item) => h('button', item.label)),
      },
    });
    await flushPromises();
    expect(wrapper.find('button').text()).toBe('Canvas');
  });

  it('shows ungated entries always, locked ones on request, and only those whose `when` holds', async () => {
    // `tags` is locked in s1.
    registerSlot(owner, 'space.domains', { key: 'own', feature: 'tags', component: text('Gated') });
    registerSlot(owner, 'space.domains', { key: 'free', feature: null, component: text('Free') });
    registerSlot(owner, 'space.domains', {
      key: 'named',
      component: text('Named'),
      when: ({ space }) => space.name === 'Blog',
    });
    const mountFor = (name: string, lockedToo = false) =>
      mount(PluginSlot, {
        props: {
          id: 'space.domains',
          props: { space: { id: 's1', name } as never },
          locked: lockedToo,
        },
      });
    const blog = mountFor('Blog');
    await flushPromises();
    expect(blog.text()).toBe('Free BlogNamed Blog');
    const shop = mountFor('Shop');
    await flushPromises();
    expect(shop.text()).toBe('Free Shop');
    const withLocked = mountFor('Shop', true);
    await flushPromises();
    expect(withLocked.text()).toBe('Gated ShopFree Shop');
  });

  it('keeps an entry marked locked for its component to draw the lock', async () => {
    // `tags` is locked and `menus` hidden in s1.
    registerSlot(owner, 'space.domains', {
      key: 'lock',
      feature: 'tags',
      locked: true,
      component: text('Lock'),
    });
    registerSlot(owner, 'space.domains', {
      key: 'gone',
      feature: 'menus',
      locked: true,
      component: text('Gone'),
    });
    const wrapper = mount(PluginSlot, {
      props: { id: 'space.domains', props: { space: { id: 's1', name: 'Blog' } as never } },
    });
    await flushPromises();
    expect(wrapper.text()).toBe('Lock Blog');
  });

  it("needs the plugin's flag on besides an entry's own, and names the one that is off", async () => {
    const locked = { id: 'locked', feature: 'tags' };
    registerSlot(locked, 'space.domains', {
      key: 'own',
      feature: 'apiKeys',
      component: text('Own'),
    });
    const items = useSlotItems('space.domains', { locked: true });
    expect(items.value.map((item) => [item.key, item.feature, item.locked])).toEqual([
      ['locked.own', 'tags', true],
    ]);
    expect(useSlotItems('space.domains').value).toEqual([]);
  });

  it('keeps the page when an entry throws while rendering', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerSlot(owner, 'audit.entities', {
      component: async () => ({
        default: defineComponent({
          setup: () => () => {
            throw new Error('boom');
          },
        }),
      }),
    });
    const wrapper = mount(
      defineComponent(
        () => () => h('div', [h('span', 'page'), h(PluginSlot, { id: 'audit.entities' })]),
      ),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('page');
    expect(error).toHaveBeenCalled();
  });
});

describe('installAdminPlugin', () => {
  beforeEach(() => {
    resetPluginRegistry();
    setActivePinia(createPinia());
  });

  function host() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: SHELL_ROUTE, component: { render: () => null }, children: [] }],
    });
    const menu: unknown[] = [];
    return { router, menu, registerMenu: (item: unknown) => menu.push(item) };
  }

  const plugin: AdminPlugin = {
    name: 'hello',
    routes: [
      { path: '/hello', name: 'hello', component: text('page'), panel: 'list' },
      { path: '/hello-out', name: 'hello-out', component: text('out'), inSpace: false },
    ],
    menu: [{ label: 'Greetings', to: '/hello' }],
    sidePanels: [{ key: 'list', label: 'Greetings', icon: 'star', component: text('panel') }],
    settingsSections: [{ id: 'greetings', label: 'Greetings', icon: 'star', component: text('s') }],
    audit: {
      entities: { 'hello.greeting': { label: 'Greeting', route: () => '/hello' } },
      actions: { 'hello.greeting.create': 'Created a greeting' },
    },
    realtime: { 'hello.greeting': vi.fn() },
    slots: { 'usage.lines': [{ key: 'hello', component: text('usage') }] },
  };

  it('adds routes, menu, panels, sections, labels and handlers under the server id', () => {
    const h = host();
    installAdminPlugin(plugin, h, { id: 'hello', feature: 'plugins.hello' });

    const route = h.router.resolve('/hello');
    expect(route.matched.map((record) => record.name)).toEqual([SHELL_ROUTE, 'hello']);
    expect(route.meta).toMatchObject({ features: ['plugins.hello'], panel: 'hello.list' });
    expect(h.router.resolve('/hello-out').matched.map((record) => record.name)).toEqual([
      'hello-out',
    ]);
    expect(h.menu).toEqual([{ feature: 'plugins.hello', label: 'Greetings', to: '/hello' }]);
    expect(pluginSidePanel('hello.list')?.label).toBe('Greetings');
    expect(pluginSettingsSections().map((section) => section.id)).toEqual(['hello.greetings']);
    expect(pluginEntityLabel('hello.greeting')).toBe('Greeting');
    expect(pluginActionLabel('hello.greeting.create')).toBe('Created a greeting');
    expect(pluginEntityRoute('hello.greeting', 'g1')).toBe('/hello');
    expect(pluginEntityRoute('other.thing', 'x')).toBeUndefined();
    expect(slotItems('usage.lines').map((item) => item.key)).toEqual(['hello.hello']);

    const event = { targetKind: 'hello.greeting' } as unknown as RealtimeEvent;
    expect(dispatchRealtime(event)).toBe(true);
    expect(plugin.realtime?.['hello.greeting']).toHaveBeenCalledWith(event);
    expect(dispatchRealtime({ targetKind: 'content' } as unknown as RealtimeEvent)).toBe(false);
  });

  it('takes editor routes, extra features and the data registries', () => {
    const h = host();
    const promoted = vi.fn();
    installAdminPlugin(
      {
        name: 'hello',
        routes: [
          {
            path: '/hello/:id',
            name: 'hello-edit',
            component: text('edit'),
            editor: 'edit',
            features: ['customDomains'],
          },
        ],
        transferSections: [
          {
            kind: 'hello.greetings',
            group: { id: 'hello', label: 'Greetings', hint: 'Hi', order: 450 },
            icon: 'star',
            label: 'Greetings',
            description: 'Every greeting.',
            noun: ['greeting', 'greetings'],
          },
        ],
        permissionIcons: { 'plugins.hello': 'star' },
        usage: { 'hello.greetings': { label: 'Greetings', blocked: 'Nobody is greeted.' } },
        invalidateOnPromote: promoted,
        audit: {
          entities: {
            'hello.greeting': { label: 'Greeting', route: (_id, meta) => `/hello/${meta?.slug}` },
          },
          verbs: { 'hello.greeting.wave': 'Waved' },
          outcomes: { 'hello.greeting.wave': (meta) => String(meta?.times) },
        },
      },
      h,
      { id: 'hello', feature: 'plugins.hello' },
    );
    expect(h.router.resolve('/hello/1').meta).toMatchObject({
      features: ['plugins.hello', 'customDomains'],
      editor: 'edit',
    });
    expect(pluginTransferSections().map((section) => section.kind)).toEqual(['hello.greetings']);
    expect(pluginPermissionIcon('plugins.hello')).toBe('star');
    expect(pluginUsageMetric('hello.greetings')?.blocked).toBe('Nobody is greeted.');
    expect(pluginEntityRoute('hello.greeting', null, { slug: 'a' })).toBe('/hello/a');
    expect(pluginVerb('hello.greeting.wave')).toBe('Waved');
    expect(pluginOutcome('hello.greeting.wave', { times: 3 })).toBe('3');
    expect(pluginOutcome('hello.greeting.create', null)).toBeUndefined();
    invalidate.promoted('s1');
    expect(promoted).toHaveBeenCalledWith('s1');
  });

  it('derives the id and flag from the name without a manifest', () => {
    const h = host();
    installAdminPlugin(
      { name: '@acme/seo', routes: [{ path: '/seo', name: 'seo', component: text('x') }] },
      h,
    );
    expect(h.router.resolve('/seo').meta.features).toEqual(['plugins.acme.seo']);
  });
});

describe('plugin-declared slots and exposed apis', () => {
  beforeEach(() => {
    resetPluginRegistry();
    setActivePinia(createPinia());
    useSessionStore().me = meWithControls();
    useSpaceStore().currentId = 's1';
  });

  const host = () => ({
    router: createRouter({ history: createMemoryHistory(), routes: [] }),
    registerMenu: () => {},
  });

  it('lets one bundle fill a slot another declares, and hands out exposed apis', async () => {
    const seen: unknown[] = [];
    const extra: AdminPlugin = {
      name: 'hello-extra',
      setup: ({ defineSlot, expose }) => {
        expect(defineSlot('greeting')).toBe('hello-extra:greeting');
        expose({ shout: (text: string) => text.toUpperCase() });
      },
    };
    const hello: AdminPlugin = {
      name: 'hello',
      slots: { ['hello-extra:greeting' as never]: [{ component: text('Filled') }] },
      setup: () => {
        seen.push(usePluginApi<{ shout(text: string): string }>('hello-extra')?.shout('hi'));
        seen.push(usePluginApi('absent'));
      },
    };
    installAdminPlugin(extra, host());
    installAdminPlugin(hello, host());

    expect(seen).toEqual(['HI', undefined]);
    const wrapper = mount(SdkPluginSlot, { props: { id: 'hello-extra:greeting', props: {} } });
    await flushPromises();
    expect(wrapper.text()).toBe('Filled');
  });

  it('refuses a slot name that is not one', () => {
    expect(() =>
      installAdminPlugin(
        { name: 'bad', setup: ({ defineSlot }) => defineSlot('two words') },
        host(),
      ),
    ).toThrow(/Invalid slot name/);
  });
});
