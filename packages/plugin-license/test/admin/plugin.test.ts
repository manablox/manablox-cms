import { queryClient } from '@manablox/admin-sdk';
import { mockAdminApi, setupAdminTest } from '@manablox/admin-sdk/testing';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LicenseSettings from '../../src/admin/components/LicenseSettings.vue';
import license from '../../src/admin/index';
import type { LicenseKeyView, LicenseOverview } from '../../src/sdk';

const licenseApi = {
  overview: vi.fn(),
  refresh: vi.fn(async () => ({})),
  addKey: vi.fn(),
};
mockAdminApi({ plugins: { license: licenseApi } });

const key = (overrides: Partial<LicenseKeyView> = {}): LicenseKeyView => ({
  id: 'k1',
  keyId: 'J06NP',
  source: 'environment',
  products: [{ product: 'ai', label: 'AI' }],
  kind: 'production',
  state: 'active',
  periodEnd: '2026-11-01T00:00:00.000Z',
  trialing: false,
  leaseExpiresAt: '2026-10-15T00:00:00.000Z',
  refreshedAt: '2026-10-01T00:00:00.000Z',
  activated: true,
  deactivated: false,
  error: null,
  ...overrides,
});

const overview = (keys: LicenseKeyView[]): LicenseOverview => ({
  keys,
  products: [
    {
      product: 'ai',
      label: 'AI',
      state: keys.length ? 'active' : 'missing',
      kind: keys.length ? 'production' : null,
      periodEnd: null,
      expiresAt: null,
      buyUrl: 'https://licenses.test/buy?products=ai',
    },
  ],
  portal: 'https://licenses.test',
  managed: false,
});

beforeEach(() => {
  setupAdminTest();
  vi.clearAllMocks();
});

async function settings(data: LicenseOverview) {
  licenseApi.overview.mockResolvedValue(data);
  const wrapper = mount(LicenseSettings, {
    global: {
      stubs: { Icon: true, NewButton: true, LicenseKeyDialog: true },
      plugins: [[VueQueryPlugin, { queryClient }]],
    },
  });
  await flushPromises();
  return wrapper;
}

describe('the license bundle', () => {
  it('adds Settings → Licenses for superadmins, at the instance', () => {
    expect(license.settingsSections).toEqual([
      expect.objectContaining({
        id: 'licenses',
        label: 'Licenses',
        icon: 'key',
        scope: 'instance',
        superadmin: true,
      }),
    ]);
    expect(license.features).toEqual({ 'plugins.license': 'License keys' });
  });

  it('labels its audit entries', () => {
    const audit = license.audit;
    expect(audit?.entities?.['license.key']?.label).toBe('License key');
    expect(audit?.entities?.['license.key']?.route?.('k1', null)).toBe(
      '/settings?tab=license.licenses',
    );
    expect(audit?.actions?.['license.key.add']).toBe('Added a license key');
    expect(audit?.verbs?.['license.key.deactivate']).toBe('Deactivated');
  });
});

describe('Settings → Licenses', () => {
  it('lists each key read-only when it comes from the environment', async () => {
    const wrapper = await settings(overview([key()]));
    expect(wrapper.text()).toContain('J06NP');
    expect(wrapper.text()).toContain('from environment');
    expect(wrapper.text()).toContain('Refresh now');
    expect(wrapper.text()).toContain('Deactivate');
    expect(wrapper.text()).not.toContain('Remove');
    const portal = wrapper.find('a[href="https://licenses.test"]');
    expect(portal.text()).toContain('Buy or manage');
  });

  it('offers removing a key added here, and shows why a key is not active', async () => {
    const wrapper = await settings(
      overview([
        key({
          source: 'admin',
          state: null,
          activated: false,
          products: [],
          kind: null,
          error: {
            key: 'plugins.license.key.noSeats',
            message: 'Every production seat of key J06NP is taken.',
            activations: [{ id: 'a1', name: 'shop.example.com', hostnames: [], lastSeenAt: null }],
          },
        }),
      ]),
    );
    expect(wrapper.text()).toContain('added here');
    expect(wrapper.text()).toContain('Remove');
    expect(wrapper.text()).toContain('Activate here');
    expect(wrapper.text()).toContain('Every production seat of key J06NP is taken.');
    expect(wrapper.text()).toContain('shop.example.com');
  });

  it('marks a trial with its end', async () => {
    const wrapper = await settings(overview([key({ trialing: true })]));
    const badge = wrapper.findAll('.mb-badge').find((entry) => entry.text().startsWith('Trial'));
    expect(badge?.text()).toMatch(/^Trial until \S/);
    expect(wrapper.text()).toContain('Trial ends');
    expect(wrapper.text()).not.toContain('Period ends');

    queryClient.clear();
    const paid = await settings(overview([key()]));
    expect(paid.findAll('.mb-badge').some((entry) => entry.text().startsWith('Trial'))).toBe(false);
    expect(paid.text()).toContain('Period ends');
  });

  it('links a product without a license to its buy page', async () => {
    const wrapper = await settings(overview([]));
    expect(wrapper.text()).toContain('No license');
    expect(wrapper.find('a[href="https://licenses.test/buy?products=ai"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('No license keys');
  });

  it('shows a product that runs without a license in development, with a buy link', async () => {
    const data = overview([]);
    const [product] = data.products;
    if (!product) throw new Error('no product');
    const wrapper = await settings({ ...data, products: [{ ...product, state: 'development' }] });
    expect(wrapper.text()).toContain('Development');
    expect(wrapper.text()).toContain('Runs without a license on this development instance');
    const buy = wrapper.find('a[href="https://licenses.test/buy?products=ai"]');
    expect(buy.text()).toBe('Buy a AI license for production');
  });

  it('refreshes a key through the router', async () => {
    const wrapper = await settings(overview([key()]));
    const button = wrapper.findAll('button').find((entry) => entry.text() === 'Refresh now');
    await button?.trigger('click');
    await flushPromises();
    expect(licenseApi.refresh).toHaveBeenCalledWith({ id: 'k1' });
  });

  it('shows hosted keys as managed by Manablox Cloud, with nothing to change', async () => {
    const wrapper = await settings({
      ...overview([key({ kind: 'hosted' })]),
      managed: true,
    });
    expect(wrapper.text()).toContain('Managed by Manablox Cloud');
    expect(wrapper.text()).toContain('J06NP');
    expect(wrapper.text()).not.toContain('Buy or manage');
    expect(wrapper.find('new-button-stub').exists()).toBe(false);
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
});
