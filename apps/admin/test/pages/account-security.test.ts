import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const api = vi.hoisted(() => ({
  users: {
    me: vi.fn(),
    verifyEmail: vi.fn(),
    setupNeeded: vi.fn(async () => ({ setupNeeded: false })),
  },
  invitations: { create: vi.fn(), preview: vi.fn(), accept: vi.fn(), list: vi.fn(async () => []) },
  instance: { settings: vi.fn(), updateSettings: vi.fn() },
  sso: { list: vi.fn(async () => ({ providers: [], authBaseUrl: 'http://api.test/api/auth' })) },
}));
vi.mock('@manablox/admin-sdk/lib/api', async (original) => ({
  ...(await original<typeof import('@manablox/admin-sdk/lib/api')>()),
  api,
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({
    currentId: 's1',
    spaces: [
      { id: 's1', name: 'Blog' },
      { id: 's2', name: 'Shop' },
    ],
    load: vi.fn(),
  }),
}));

import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import InviteDialog from '~/components/invitations/InviteDialog.vue';
import SecuritySettings from '~/features/security/components/SecuritySettings.vue';
import TwoFactorEnrol from '~/features/users/components/TwoFactorEnrol.vue';
import AcceptInvite from '~/pages/AcceptInvite.vue';
import Login from '~/pages/Login.vue';
import TwoFactorChallenge from '~/pages/TwoFactorChallenge.vue';
import VerifyEmail from '~/pages/VerifyEmail.vue';
import { meWithControls } from '../controls-fixture';

const Blank = { template: '<div />' };
/** Renders a dialog's slots in place. */
const Dialog = defineComponent({
  setup:
    (_props, { slots }) =>
    () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })],
});
const URI = 'otpauth://totp/Manablox:ada%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Manablox';

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

async function render(component: object, path: string, props: Record<string, unknown> = {}) {
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
    props,
    attachTo: document.body,
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient }]],
      stubs: { AuthScene: true, ThemeToggle: true, Icon: true, Dialog },
    },
  });
  await flushPromises();
  return wrapper;
}

/** The signed-in account with a two-factor state. */
function me(twoFactor = { enabled: false, available: true, required: false, pending: false }) {
  return { ...meWithControls(), emailVerified: true, twoFactor };
}

beforeEach(() => {
  setActivePinia(createPinia());
  queryClient.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('signing in with two-factor', () => {
  it('sends a sign-in that needs a code to the second step', async () => {
    stubAuth({
      'password-reset/status': { body: { enabled: false } },
      'sign-in/email': { body: { twoFactorRedirect: true, twoFactorMethods: ['totp'] } },
    });
    const wrapper = await render(Login, '/login?redirect=/page');
    await wrapper.find('input[type="email"]').setValue('ada@example.test');
    await wrapper.find('input[type="password"]').setValue('a-password-123');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('two-factor');
    expect(router.currentRoute.value.query.redirect).toBe('/page');
    expect(api.users.me).not.toHaveBeenCalled();
  });

  it('checks an app code and then a backup code, and continues', async () => {
    const calls = stubAuth({
      'two-factor/verify-totp': {
        status: 401,
        body: { code: 'INVALID_CODE', message: 'Invalid code' },
      },
      'two-factor/verify-backup-code': { body: { token: 't' } },
    });
    api.users.me.mockResolvedValue(me());
    const wrapper = await render(TwoFactorChallenge, '/two-factor?redirect=/page');
    await wrapper.find('input').setValue('123 456');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(calls.at(-1)).toEqual({
      path: 'two-factor/verify-totp',
      body: { code: '123456', trustDevice: false },
    });
    expect(wrapper.text()).toContain('That code is not right.');

    await wrapper.find('button[type="button"]').trigger('click');
    await wrapper.find('input').setValue('abcde-12345');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(calls.at(-1)).toEqual({
      path: 'two-factor/verify-backup-code',
      body: { code: 'abcde-12345' },
    });
    expect(api.users.me).toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe('/page');
  });

  it('asks to sign in again once the pending sign-in expired', async () => {
    stubAuth({
      'two-factor/verify-totp': {
        status: 401,
        body: { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'Invalid two factor cookie' },
      },
    });
    const wrapper = await render(TwoFactorChallenge, '/two-factor');
    await wrapper.find('input').setValue('123456');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Sign in again');
    expect(wrapper.find('form').exists()).toBe(false);
  });
});

describe('setting up two-factor', () => {
  it('confirms the password, shows the key and ends with the backup codes', async () => {
    const calls = stubAuth({
      'two-factor/enable': { body: { totpURI: URI, backupCodes: ['aaaaa-11111', 'bbbbb-22222'] } },
      'two-factor/verify-totp': { body: { token: 't' } },
    });
    const wrapper = await render(TwoFactorEnrol, '/page');
    await wrapper.find('input[type="password"]').setValue('a-password-123');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(calls[0]).toEqual({ path: 'two-factor/enable', body: { password: 'a-password-123' } });
    expect(wrapper.find('[data-testid="totp-qr"] svg').exists()).toBe(true);
    expect(wrapper.find('[data-testid="totp-secret"]').text()).toBe('JBSW Y3DP EHPK 3PXP');

    await wrapper.find('input').setValue('654321');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(calls[1]).toEqual({ path: 'two-factor/verify-totp', body: { code: '654321' } });
    expect(wrapper.emitted('enrolled')).toHaveLength(1);
    expect(wrapper.find('[data-testid="backup-codes"]').text()).toContain('bbbbb-22222');
  });

  it('says so when the feature is off', async () => {
    stubAuth({
      'two-factor/enable': {
        status: 403,
        body: { code: 'FEATURE_OFF', message: 'control.feature' },
      },
    });
    const wrapper = await render(TwoFactorEnrol, '/page');
    await wrapper.find('input[type="password"]').setValue('a-password-123');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('This feature is not available here.');
  });
});

describe('the two-factor policy setting', () => {
  it('offers only "optional" while the feature is off', async () => {
    api.instance.settings.mockResolvedValue({
      twoFactor: { policy: 'off', effective: 'off', available: false },
    });
    const session = useSessionStore();
    const base = me();
    session.me = {
      ...base,
      controls: { ...base.controls, features: { twoFactor: { presentation: 'locked' } } },
    } as never;
    const wrapper = await render(SecuritySettings, '/page');
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios.map((radio) => (radio.element as HTMLInputElement).disabled)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('saves a policy', async () => {
    api.instance.settings.mockResolvedValue({
      twoFactor: { policy: 'off', effective: 'off', available: true },
    });
    api.instance.updateSettings.mockResolvedValue({
      twoFactor: { policy: 'admins', effective: 'admins', available: true },
    });
    api.users.me.mockResolvedValue(me());
    useSessionStore().me = me() as never;
    const wrapper = await render(SecuritySettings, '/page');
    await wrapper.findAll('input[type="radio"]')[1]?.setValue(true);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(api.instance.updateSettings).toHaveBeenCalledWith({ twoFactorPolicy: 'admins' });
  });
});

describe('confirming an email address', () => {
  it('redeems the link at once', async () => {
    api.users.verifyEmail.mockResolvedValue({ email: 'new@example.test' });
    const wrapper = await render(VerifyEmail, '/page?token=abcdefghijklmnop');
    expect(api.users.verifyEmail).toHaveBeenCalledWith({ token: 'abcdefghijklmnop' });
    expect(wrapper.text()).toContain('new@example.test is confirmed');
  });

  it('explains a used link', async () => {
    api.users.verifyEmail.mockRejectedValue(new Error('auth.email.tokenInvalid'));
    const wrapper = await render(VerifyEmail, '/page?token=abcdefghijklmnop');
    expect(wrapper.text()).toContain('This link is invalid or has expired.');
  });
});

describe('accepting an invitation', () => {
  const preview = (accountExists: boolean) => ({
    email: 'guest@example.test',
    inviter: 'Grace',
    spaces: [{ id: 's1', name: 'Blog', role: 'editor' }],
    expiresAt: new Date('2026-10-01'),
    accountExists,
  });

  it('sets up an account and signs in with it', async () => {
    api.invitations.preview.mockResolvedValue(preview(false));
    api.invitations.accept.mockResolvedValue({
      userId: 'u9',
      email: 'guest@example.test',
      created: true,
    });
    api.users.me.mockResolvedValue(me());
    const calls = stubAuth({ 'sign-in/email': { body: { token: 't' } } });
    const wrapper = await render(AcceptInvite, '/page?token=abcdefghijklmnop');
    expect(wrapper.find('[data-testid="invite-summary"]').text()).toContain(
      'Grace invited guest@example.test to Blog (editor)',
    );
    const [name, password, again] = wrapper.findAll('input');
    await name?.setValue('Guest');
    await password?.setValue('a-password-123');
    await again?.setValue('a-password-123');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(api.invitations.accept).toHaveBeenCalledWith({
      token: 'abcdefghijklmnop',
      name: 'Guest',
      password: 'a-password-123',
    });
    expect(calls.at(-1)).toEqual({
      path: 'sign-in/email',
      body: { email: 'guest@example.test', password: 'a-password-123' },
    });
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('asks an existing account to sign in first', async () => {
    api.invitations.preview.mockResolvedValue(preview(true));
    const wrapper = await render(AcceptInvite, '/page?token=abcdefghijklmnop');
    expect(wrapper.text()).toContain('already has an account');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.findAll('a').map((link) => link.attributes('href'))).toContainEqual(
      expect.stringContaining('/login?redirect='),
    );
  });

  it('shows why a link no longer works', async () => {
    api.invitations.preview.mockRejectedValue(new Error('invitation.expired'));
    const wrapper = await render(AcceptInvite, '/page?token=abcdefghijklmnop');
    expect(wrapper.text()).toContain('This invitation has expired.');
  });
});

describe('inviting', () => {
  it('shows the link to copy when no mail carries it', async () => {
    api.invitations.create.mockResolvedValue({
      invitation: { id: 'i1' },
      link: 'http://admin.test/accept-invite?token=xyz',
    });
    useSessionStore().me = me() as never;
    const wrapper = await render(InviteDialog, '/page', { spaceId: 's1' });
    await wrapper.find('input[type="email"]').setValue('guest@example.test');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(api.invitations.create).toHaveBeenCalledWith({
      email: 'guest@example.test',
      grants: [{ spaceId: 's1', role: 'editor' }],
    });
    expect((wrapper.find('input[readonly]').element as HTMLInputElement).value).toBe(
      'http://admin.test/accept-invite?token=xyz',
    );
    wrapper.unmount();
  });
});
