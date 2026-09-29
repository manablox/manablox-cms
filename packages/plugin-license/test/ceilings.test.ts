import type { Contribution, FeatureKey } from '@manablox/core';
import { createLogger } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { describe, expect, it, vi } from 'vitest';
import type { LicenseProductEntry, LicenseState } from '../src/sdk.js';
import { licenseConfig } from '../src/server/config.js';
import {
  ceilingBanners,
  ceilingFeatures,
  lapseSets,
  portalLinks,
} from '../src/server/services/license/ceilings.js';
import type { Entitlement } from '../src/server/services/license/state.js';
import { LicenseService } from '../src/server/services/license.service.js';
import { INSTANCE_ID, T0 } from './helpers/leases.js';

const links = portalLinks('https://portal.test');
const lapse = new Map<'ai' | 'website', FeatureKey[]>([
  ['ai', ['plugins.ai']],
  ['website', ['plugins.website.design', 'plugins.website.domains']],
]);

const entitlement = (state: LicenseState, extra: Partial<Entitlement> = {}): Entitlement => ({
  product: 'ai',
  state,
  kind: 'production',
  periodEnd: new Date((T0 + 86_400) * 1000),
  exp: new Date('2026-10-15T12:00:00.000Z'),
  ...extra,
});

describe('the ceiling of each state', () => {
  const unlocked: LicenseState[] = [
    'active',
    'canceled',
    'pastDue',
    'grace',
    'expiring',
    'conflict',
  ];

  it('locks nothing while a lease covers the product', () => {
    for (const state of unlocked) {
      expect([state, ceilingFeatures([entitlement(state)], lapse, links).size]).toEqual([state, 0]);
    }
  });

  it("switches a lapsed or missing product's lapse set off, with a buy link", () => {
    expect(Object.fromEntries(ceilingFeatures([entitlement('lapsed')], lapse, links))).toEqual({
      'plugins.ai': {
        enabled: false,
        presentation: 'locked',
        message: 'The AI plugin needs a license.',
        link: 'https://portal.test/buy?products=ai',
      },
    });
    const website = ceilingFeatures(
      [entitlement('missing', { product: 'website', kind: null })],
      lapse,
      links,
    );
    expect([...website.keys()]).toEqual(['plugins.website.design', 'plugins.website.domains']);
    expect(website.get('plugins.website.design')).toMatchObject({
      message: 'Add a license key for the Website plugin.',
      link: 'https://portal.test/buy?products=website',
    });
    const development = ceilingFeatures(
      [entitlement('missing', { kind: 'development', reason: 'developmentOnPublicHost' })],
      lapse,
      links,
    );
    expect(development.get('plugins.ai')?.message).toBe(
      'A public domain needs a production license for the AI plugin.',
    );
  });

  it('warns per state, at the level the state asks for', () => {
    const banner = (state: LicenseState, extra: Partial<Entitlement> = {}) =>
      ceilingBanners([entitlement(state, extra)], links);
    expect(banner('active')).toEqual([]);
    expect(banner('canceled')).toEqual([
      {
        id: 'license.ai.canceled',
        level: 'warning',
        text: 'Your AI subscription ends on 2026-10-02.',
        link: 'https://portal.test/subscriptions',
        dismissible: true,
        audience: 'superadmin',
      },
    ]);
    expect(banner('pastDue')[0]).toMatchObject({ level: 'warning', link: links.manage });
    expect(banner('grace')[0]).toMatchObject({
      level: 'warning',
      text: 'The AI license was not renewed. Its features lock on 2026-10-15.',
    });
    expect(banner('expiring')[0]).toMatchObject({ level: 'danger', dismissible: false });
    expect(banner('conflict')[0]?.text).toContain('manablox license activate');
    expect(banner('lapsed')[0]).toMatchObject({
      level: 'danger',
      link: 'https://portal.test/buy?products=ai',
    });
    expect(banner('missing')[0]?.id).toBe('license.ai.missing');
  });

  it('marks a development license with an info banner nobody can dismiss', () => {
    expect(ceilingBanners([entitlement('active', { kind: 'development' })], links)).toEqual([
      {
        id: 'license.development',
        level: 'info',
        text: 'Development license: the premium plugins run here for development only.',
        dismissible: false,
        audience: 'all',
      },
    ]);
    // Not while the development lease covers nothing.
    const locked = entitlement('missing', {
      kind: 'development',
      reason: 'developmentOnPublicHost',
    });
    expect(ceilingBanners([locked], links).map((banner) => banner.id)).toEqual([
      'license.ai.missing',
    ]);
  });

  it('joins the lapse sets of every plugin selling a product', () => {
    const entries: Contribution<LicenseProductEntry>[] = [
      { plugin: 'a', entry: { product: 'ai', lapse: ['plugins.a'] } },
      { plugin: 'b', entry: { product: 'ai', lapse: ['plugins.b', 'plugins.a'] } },
    ];
    expect(lapseSets(entries).get('ai')).toEqual(['plugins.a', 'plugins.b']);
  });
});

describe('the ceiling provider', () => {
  const products: Contribution<LicenseProductEntry>[] = [
    { plugin: 'seller', entry: { product: 'ai', lapse: ['plugins.seller.design'] } },
  ];
  const logger = createLogger({ level: 'fatal' });

  function service(overrides: Partial<ConstructorParameters<typeof LicenseService>[0]> = {}) {
    return new LicenseService({
      config: licenseConfig({ keys: [], now: () => T0 * 1000 }, {}),
      // Nothing to read from: every query throws.
      repos: {} as Repositories,
      logger,
      secret: 'secret-secret-secret',
      instanceId: () => INSTANCE_ID,
      products: () => products,
      hostnames: async () => ['localhost'],
      versions: {},
      publish: () => {},
      ...overrides,
    });
  }

  it('locks the lapse sets before the leases are read', () => {
    const provider = service().ceiling();
    expect(provider.features().get('plugins.seller.design')).toMatchObject({
      enabled: false,
      message: 'The AI license could not be checked.',
    });
  });

  it('fails closed and logs when the leases cannot be read', async () => {
    const error = vi.spyOn(logger, 'error');
    const licenses = service();
    const provider = licenses.ceiling();
    const before = provider.version();
    await licenses.load();
    expect(error).toHaveBeenCalled();
    expect(provider.features().get('plugins.seller.design')?.enabled).toBe(false);
    expect(licenses.entitlement('ai')).toMatchObject({ state: 'lapsed', reason: 'unchecked' });
    expect(provider.version()).toBeGreaterThanOrEqual(before);
    error.mockRestore();
  });

  it('never throws, even when nothing can be built', () => {
    const provider = service({
      products: () => {
        throw new Error('broken');
      },
    }).ceiling();
    expect(() => provider.version()).not.toThrow();
    expect(() => provider.features()).not.toThrow();
    expect(() => provider.banners?.()).not.toThrow();
  });
});
