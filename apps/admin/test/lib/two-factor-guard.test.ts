import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  users: { me: vi.fn(), setupNeeded: vi.fn(async () => ({ setupNeeded: false })) },
}));
vi.mock('@manablox/admin-sdk/lib/api', async (original) => ({
  ...(await original<typeof import('@manablox/admin-sdk/lib/api')>()),
  api,
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: null, spaces: [] }),
}));

import { router } from '~/router';
import { meWithControls } from '../controls-fixture';

const me = (pending: boolean) => ({
  ...meWithControls(),
  twoFactor: { enabled: false, available: true, required: pending, pending },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('the two-factor enrolment guard', () => {
  it('holds an account the policy covers at the setup page', async () => {
    api.users.me.mockResolvedValue(me(true));
    await router.push('/settings?tab=users');
    expect(router.currentRoute.value.name).toBe('two-factor-setup');
    expect(router.currentRoute.value.query.redirect).toBe('/settings?tab=users');
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('two-factor-setup');
  });

  it('sends everyone else past the setup page', async () => {
    api.users.me.mockResolvedValue(me(false));
    await router.push('/two-factor/setup');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });
});
