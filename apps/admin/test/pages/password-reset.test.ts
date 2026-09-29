import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import ForgotPassword from '~/pages/ForgotPassword.vue';
import Login from '~/pages/Login.vue';
import ResetPassword from '~/pages/ResetPassword.vue';

const Blank = { template: '<div />' };

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answers `/api/auth/*` by path; records every call. */
function stubAuth(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const path = url.replace('/api/auth/', '');
    const answer = answers[path] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return calls;
}

async function render(component: object, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: Blank },
      { path: '/forgot-password', name: 'forgot-password', component: Blank },
      { path: '/reset-password', name: 'reset-password', component: Blank },
    ],
  });
  await router.push(path);
  const wrapper = mount(component, {
    global: { plugins: [router], stubs: { AuthScene: true, ThemeToggle: true } },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('sign-in', () => {
  it('offers "forgot password" only when the instance can mail', async () => {
    stubAuth({ 'password-reset/status': { body: { enabled: true } } });
    expect((await render(Login, '/login')).text()).toContain('Forgot password?');

    stubAuth({ 'password-reset/status': { body: { enabled: false } } });
    expect((await render(Login, '/login')).text()).not.toContain('Forgot password?');
  });
});

describe('forgot password', () => {
  it('requests a link and answers without naming an account', async () => {
    const calls = stubAuth({
      'password-reset/status': { body: { enabled: true } },
      'request-password-reset': { body: { status: true } },
    });
    const wrapper = await render(ForgotPassword, '/forgot-password?email=ada@example.test');
    expect((wrapper.find('input[type="email"]').element as HTMLInputElement).value).toBe(
      'ada@example.test',
    );
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(calls.at(-1)).toMatchObject({
      url: '/api/auth/request-password-reset',
      method: 'POST',
      body: { email: 'ada@example.test' },
    });
    expect(wrapper.text()).toContain('If an account uses');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('points to an administrator when mail is off', async () => {
    stubAuth({ 'password-reset/status': { body: { enabled: false } } });
    const wrapper = await render(ForgotPassword, '/forgot-password');
    expect(wrapper.text()).toContain('cannot send mail');
    expect(wrapper.find('form').exists()).toBe(false);
  });
});

describe('reset password', () => {
  it('sets the password with the token from the link', async () => {
    const calls = stubAuth({ 'reset-password': { body: { status: true } } });
    const wrapper = await render(ResetPassword, '/reset-password?token=abc123');
    const [first, second] = wrapper.findAll('input[type="password"]');
    await first?.setValue('a-new-password-1');
    await second?.setValue('a-new-password-1');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(calls.at(-1)).toMatchObject({
      url: '/api/auth/reset-password',
      body: { token: 'abc123', newPassword: 'a-new-password-1' },
    });
    expect(wrapper.text()).toContain('Your password is set');
  });

  it('flags two different passwords and sends nothing', async () => {
    const calls = stubAuth({});
    const wrapper = await render(ResetPassword, '/reset-password?token=abc123');
    const [first, second] = wrapper.findAll('input[type="password"]');
    await first?.setValue('a-new-password-1');
    await second?.setValue('a-new-password-2');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('The two do not match.');
    expect(calls).toEqual([]);
  });

  it('explains a used or expired link', async () => {
    stubAuth({
      'reset-password': { status: 400, body: { code: 'INVALID_TOKEN', message: 'Invalid token' } },
    });
    const wrapper = await render(ResetPassword, '/reset-password?token=used');
    const [first, second] = wrapper.findAll('input[type="password"]');
    await first?.setValue('a-new-password-1');
    await second?.setValue('a-new-password-1');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('already used or has expired');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('says so when the link has no token', async () => {
    stubAuth({});
    const wrapper = await render(ResetPassword, '/reset-password');
    expect(wrapper.text()).toContain('This link is not complete.');
  });
});
