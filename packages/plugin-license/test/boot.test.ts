import { definePlugin } from '@manablox/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootLicense, type LicenseInstance, SELLER_LAPSE } from './helpers/boot.js';
import { DAY } from './helpers/leases.js';

let target: LicenseInstance;

beforeAll(async () => {
  target = await bootLicense('boot', {
    license: (server) => ({ keys: [server.addKey({ products: ['ai'] })], kind: 'production' }),
    public: true,
  });
  await target.services().licenses.reconcile();
}, 60_000);

afterAll(async () => {
  await target?.close();
});

const runtimes = () => {
  if (!target.pub) throw new Error('no public process');
  return { management: target.api, public: target.pub };
};

describe('the license ceiling at boot', () => {
  it('is read by every process before it serves', async () => {
    const { public: pub } = runtimes();
    // Read at boot, before the key was activated: evaluated, not merely unchecked.
    const before = target.services(pub).entitlement('ai');
    expect(before.reason).toBeUndefined();
    await target.services(pub).licenses.load();
    expect(target.services(pub).entitlement('ai').state).toBe('active');
  });

  it("switches a lapsed product's lapse set off in management and public mode", async () => {
    for (const [mode, runtime] of Object.entries(runtimes())) {
      const design = await runtime.manablox.controls.feature(null, SELLER_LAPSE);
      expect([mode, design.enabled]).toEqual([mode, true]);
    }
    // No refresh gets through; the lease runs out after 14 days.
    target.clock.now += 14 * DAY * 1000;
    for (const [mode, runtime] of Object.entries(runtimes())) {
      const design = await runtime.manablox.controls.feature(null, SELLER_LAPSE);
      expect([mode, design]).toEqual([
        mode,
        {
          enabled: false,
          presentation: 'locked',
          message: 'The AI plugin needs a license.',
          link: 'https://licenses.test/buy?products=ai',
        },
      ]);
      // The plugin stays on; only the lapse set locks.
      expect(await runtime.manablox.plugins.isOn('seller', null)).toBe(true);
      await expect(
        runtime.manablox.controls.assertFeature(null, SELLER_LAPSE),
      ).rejects.toMatchObject({ key: 'control.feature' });
    }
    expect(target.api.manablox.ceilings.current().banners).toEqual([
      expect.objectContaining({ id: 'license.ai.lapsed', level: 'danger' }),
    ]);
  });
});

describe('the products extension point', () => {
  const boot = (plugin: ReturnType<typeof definePlugin>) =>
    bootLicense('boot-refused', { plugins: [plugin] });

  it("refuses a lapse set with another plugin's features", async () => {
    const greedy = definePlugin({
      name: 'greedy',
      contributions: { license: { products: [{ product: 'ai', lapse: ['plugins.seller'] }] } },
    });
    await expect(boot(greedy)).rejects.toThrow(/plugins\.seller is not one of its features/);
  });

  it('refuses a product that is not for sale', async () => {
    const odd = definePlugin({
      name: 'odd',
      contributions: {
        license: { products: [{ product: 'shop' as 'ai', lapse: ['plugins.odd'] }] },
      },
    });
    await expect(boot(odd)).rejects.toThrow(/shop is not a premium product/);
  });
});
