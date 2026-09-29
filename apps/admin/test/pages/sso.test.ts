import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const api = vi.hoisted(() => ({
  users: { me: vi.fn(), setupNeeded: vi.fn(async () => ({ setupNeeded: false })) },
  instance: { settings: vi.fn(), updateSettings: vi.fn() },
  sso: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), test: vi.fn() },
  roles: { list: vi.fn(async () => []) },
}));
vi.mock('@manablox/admin-sdk/lib/api', async (original) => ({
  ...(await original<typeof import('@manablox/admin-sdk/lib/api')>()),
  api,
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({
    currentId: 's1',
    spaces: [{ id: 's1', name: 'Blog' }],
    load: vi.fn(),
  }),
}));

import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import SecuritySettings from '~/features/security/components/SecuritySettings.vue';
import Login from '~/pages/Login.vue';
import { meWithControls } from '../controls-fixture';

const Blank = { template: '<div />' };
/** Renders a dialog's slots in place. */
const Dialog = defineComponent({
  setup(_props, { slots, expose }) {
    expose({ requestClose: () => {} });
    return () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })];
  },
});

interface Call {
  path: string;
  body: unknown;
}

/** Answers `/api/auth/*` by path; records every call. */
function stubAuth(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/auth/', '');
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[path] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return calls;
}

let router: Router;

async function render(component: object, path: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: Blank },
      { path: '/login', name: 'login', component: Blank },
      { path: '/two-factor', name: 'two-factor', component: Blank },
      { path: '/forgot-password', name: 'forgot-password', component: Blank },
      { path: '/page', name: 'page', component: Blank },
    ],
  });
  await router.push(path);
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient }]],
      stubs: { AuthScene: true, ThemeToggle: true, Icon: true, Dialog },
    },
  });
  await flushPromises();
  return wrapper;
}

/** Waits out the address check's pause and its answer. */
async function afterLookup() {
  await vi.advanceTimersByTimeAsync(400);
  await flushPromises();
}

const ACME = { providerId: 'acme', name: 'Acme' };

beforeEach(() => {
  setActivePinia(createPinia());
  queryClient.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('signing in with single sign-on', () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    assign.mockRestore();
  });

  it('lists providers configured for the page and leaves for the one clicked', async () => {
    const calls = stubAuth({
      'password-reset/status': { body: { enabled: false } },
      'sso/sign-in-providers': { body: { providers: [ACME] } },
      'sign-in/sso': { body: { url: 'https://idp.acme.test/authorize?x=1', redirect: true } },
    });
    const wrapper = await render(Login, '/login?redirect=/page');
    const button = wrapper.findAll('button').find((b) => b.text().includes('Continue with Acme'));
    expect(button).toBeDefined();
    await button?.trigger('click');
    await flushPromises();
    const started = calls.find((call) => call.path === 'sign-in/sso');
    expect(started?.body).toMatchObject({
      providerId: 'acme',
      callbackURL: `${window.location.origin}/page`,
      errorCallbackURL: `${window.location.origin}/login?redirect=/page`,
    });
    expect(assign).toHaveBeenCalledWith('https://idp.acme.test/authorize?x=1');
  });

  it('offers the provider of a typed address, and drops the password where it is required', async () => {
    const calls = stubAuth({
      'password-reset/status': { body: { enabled: true } },
      'sso/sign-in-providers': { body: { providers: [] } },
      'sso/lookup': { body: { provider: { ...ACME, required: true } } },
      'sign-in/sso': { body: { url: 'https://idp.acme.test/authorize', redirect: true } },
    });
    const wrapper = await render(Login, '/login');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    await wrapper.find('input[type="email"]').setValue('kim@acme.test');
    await afterLookup();
    expect(calls.find((call) => call.path === 'sso/lookup')?.body).toEqual({
      email: 'kim@acme.test',
    });
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="sso-only"]').text()).toContain('Acme');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(calls.some((call) => call.path === 'sign-in/email')).toBe(false);
    expect(calls.find((call) => call.path === 'sign-in/sso')?.body).toMatchObject({
      providerId: 'acme',
    });
    expect(assign).toHaveBeenCalledWith('https://idp.acme.test/authorize');
  });

  it('keeps the password next to an optional provider', async () => {
    stubAuth({
      'password-reset/status': { body: { enabled: false } },
      'sso/sign-in-providers': { body: { providers: [] } },
      'sso/lookup': { body: { provider: { ...ACME, required: false } } },
    });
    const wrapper = await render(Login, '/login');
    await wrapper.find('input[type="email"]').setValue('kim@acme.test');
    await afterLookup();
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="sso-buttons"]').text()).toContain('Continue with Acme');
  });

  it('explains a refusal the identity provider round trip ended with', async () => {
    stubAuth({
      'password-reset/status': { body: { enabled: false } },
      'sso/sign-in-providers': { body: { providers: [] } },
    });
    const wrapper = await render(Login, '/login?error=sso_seats&error_description=auth.sso.seats');
    expect(wrapper.find('[role="alert"]').text()).toContain('the account limit is reached');
    const other = await render(Login, '/login?error=invalid_state&error_description=whatever');
    expect(other.find('[role="alert"]').text()).toContain('did not complete (invalid_state)');
  });
});

describe('SSO settings', () => {
  const provider = {
    id: 'p1',
    providerId: 'acme',
    name: 'Acme',
    protocol: 'oidc',
    domains: ['acme.test'],
    oidc: {
      issuer: 'https://login.acme.test',
      clientId: 'client',
      clientSecretHint: 'abcd',
      discoveryEndpoint: 'https://login.acme.test/.well-known/openid-configuration',
      scopes: ['openid', 'email', 'profile'],
    },
    saml: null,
    requireSso: true,
    showOnSignIn: false,
    createAccounts: true,
    defaultGrants: [],
    urls: { callback: 'https://api.test/api/auth/sso/callback/acme', acs: null, metadata: null },
  };

  function signedIn(features: Record<string, unknown> = {}) {
    const me = { ...meWithControls(), role: 'superadmin' } as never as ReturnType<
      typeof meWithControls
    >;
    (me as { controls: { features: unknown } }).controls.features = features;
    useSessionStore().me = me;
    api.instance.settings.mockResolvedValue({
      twoFactor: { policy: 'off', effective: 'off', available: true },
    });
  }

  it('lists providers and adds an OIDC one with the URLs to copy', async () => {
    signedIn();
    api.sso.list.mockResolvedValue({
      providers: [provider],
      authBaseUrl: 'https://api.test/api/auth',
    });
    api.sso.create.mockResolvedValue({ ...provider, id: 'p2', providerId: 'corp' });
    const wrapper = await render(SecuritySettings, '/page');
    const section = wrapper.find('[data-testid="sso-settings"]');
    expect(section.text()).toContain('Acme');
    expect(section.text()).toContain('acme.test');
    expect(section.text()).toContain('Required');

    await section
      .findAll('button')
      .find((b) => b.text().includes('Add provider'))
      ?.trigger('click');
    await flushPromises();
    const fields = () => wrapper.findAll('[data-testid="sso-settings"] input');
    const byLabel = (label: string) => {
      const target = wrapper
        .findAll('label')
        .find((node) => node.text().trim() === label)
        ?.attributes('for');
      return wrapper.find(`#${target}`);
    };
    await byLabel('Name').setValue('Corp');
    await byLabel('Provider id').setValue('corp');
    await byLabel('Issuer URL').setValue('https://login.corp.test');
    await byLabel('Client id').setValue('corp-client');
    await byLabel('Client secret').setValue('corp-secret');
    const domain = fields().find((input) => input.attributes('aria-label') === 'Email domain');
    await domain?.setValue('corp.test');
    await domain?.trigger('keydown', { key: 'Enter' });
    expect(wrapper.text()).toContain('https://api.test/api/auth/sso/callback/corp');

    await wrapper.find('[data-testid="sso-settings"] form').trigger('submit');
    await flushPromises();
    expect(api.sso.create).toHaveBeenCalledWith({
      providerId: 'corp',
      name: 'Corp',
      domains: ['corp.test'],
      requireSso: false,
      showOnSignIn: false,
      createAccounts: true,
      defaultGrants: [],
      oidc: {
        issuer: 'https://login.corp.test',
        clientId: 'corp-client',
        clientSecret: 'corp-secret',
        scopes: [],
      },
    });
  });

  it('shows field errors from the server', async () => {
    signedIn();
    api.sso.list.mockResolvedValue({
      providers: [provider],
      authBaseUrl: 'https://api.test/api/auth',
    });
    api.sso.update.mockRejectedValue(
      Object.assign(new Error('sso.validation.failed'), {
        data: {
          key: 'sso.validation.failed',
          details: [
            {
              key: 'sso.discovery.failed',
              path: ['oidc', 'issuer'],
              params: { reason: 'Discovery endpoint not found' },
            },
          ],
        },
      }),
    );
    const wrapper = await render(SecuritySettings, '/page');
    await wrapper.find('[aria-label="Edit Acme"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="sso-settings"] form').trigger('submit');
    await flushPromises();
    expect(api.sso.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p1',
        oidc: expect.not.objectContaining({ clientSecret: '' }),
      }),
    );
    expect(wrapper.text()).toContain(
      'The identity provider could not be reached: Discovery endpoint not found',
    );
  });

  it('is read-only with a lock while the feature is off', async () => {
    signedIn({ sso: { presentation: 'locked', message: 'Upgrade for SSO' } });
    api.sso.list.mockResolvedValue({
      providers: [provider],
      authBaseUrl: 'https://api.test/api/auth',
    });
    const wrapper = await render(SecuritySettings, '/page');
    const section = wrapper.find('[data-testid="sso-settings"]');
    expect(section.text()).toContain('Acme');
    expect(section.text()).toContain('nobody signs in through these providers');
    expect(section.find('[aria-label="Edit Acme"]').exists()).toBe(false);
    expect(section.findAll('button').some((b) => b.text().includes('Add provider'))).toBe(false);
  });

  it('is left out when the feature is hidden', async () => {
    signedIn({ sso: { presentation: 'hidden' } });
    api.sso.list.mockResolvedValue({ providers: [], authBaseUrl: 'https://api.test/api/auth' });
    const wrapper = await render(SecuritySettings, '/page');
    expect(wrapper.find('[data-testid="sso-settings"]').exists()).toBe(false);
  });
});
