import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BootOptions,
  bootLicense,
  type LicenseInstance,
  SELLER_LAPSE,
  sellerPlugin,
} from './helpers/boot.js';

let instance: LicenseInstance | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  await instance?.close();
  instance = null;
});

/** The website's domains, as the seller serves them. */
let domains: string[] = [];

/** Boots with the `auto` kind, unless `license` says otherwise; no key by default. */
async function boot(options: BootOptions = {}) {
  domains = [];
  instance = await bootLicense('development', {
    plugins: [sellerPlugin(() => domains)],
    ...options,
  });
  await instance.services().licenses.reconcile();
  return instance;
}

const designOf = (target: LicenseInstance) =>
  target.api.manablox.controls.feature(null, SELLER_LAPSE);
const bannerIds = (target: LicenseInstance) =>
  target.api.manablox.ceilings.current().banners.map((banner) => banner.id);

describe('a development instance without a key', () => {
  it('runs the premium products on private hosts, with the development notice', async () => {
    const target = await boot({ public: true });
    for (const runtime of [target.api, target.pub ?? target.api]) {
      expect(target.services(runtime).entitlement('ai')).toEqual({
        product: 'ai',
        state: 'development',
        kind: null,
        periodEnd: null,
        exp: null,
      });
      expect((await runtime.manablox.controls.feature(null, SELLER_LAPSE)).enabled).toBe(true);
    }
    expect(target.api.manablox.ceilings.current().banners).toEqual([
      {
        id: 'license.development',
        level: 'info',
        text: 'Development instance: the premium plugins run without a production license, on private hosts only.',
        dismissible: false,
        audience: 'all',
      },
    ]);
    // Nothing was activated: no key, no call.
    expect(target.server.calls).toEqual([]);
    expect(target.services().licenses.overview().products).toMatchObject([
      { product: 'ai', state: 'development', kind: null },
    ]);
  });

  it('refuses a public request host', async () => {
    const { allowsHost } = (await boot()).services();
    expect(allowsHost('ai', 'localhost:3000')).toBe(true);
    expect(allowsHost('ai', 'cms.test')).toBe(true);
    expect(allowsHost('ai', '192.168.1.20')).toBe(true);
    expect(allowsHost('ai', 'www.example.com')).toBe(false);
    expect(allowsHost('ai', '')).toBe(false);
  });

  it('locks once a public site domain appears, and runs again once it is gone', async () => {
    const target = await boot();
    const { licenses } = target.services();
    domains = ['www.example.com'];
    await licenses.load();
    expect(target.services().entitlement('ai')).toMatchObject({ state: 'missing', kind: null });
    expect(await designOf(target)).toMatchObject({
      enabled: false,
      message: 'Add a license key for the AI plugin.',
    });
    expect(bannerIds(target)).toEqual(['license.ai.missing']);
    domains = ['preview.localhost'];
    await licenses.load();
    expect(target.services().entitlement('ai').state).toBe('development');
    expect((await designOf(target)).enabled).toBe(true);
  });

  it('is no development instance with a public URL or a preview host outside devHosts', async () => {
    const target = await boot({ config: { server: { publicUrl: 'https://cms.example.com' } } });
    expect(target.services().entitlement('ai').state).toBe('missing');
    await target.close();
    instance = null;
    const allowed = await boot({
      config: { server: { publicUrl: 'https://cms.example.com' } },
      license: () => ({ devHosts: ['cms.example.com'] }),
    });
    expect(allowed.services().entitlement('ai').state).toBe('development');
  });

  it('is no development instance under NODE_ENV=production, unless the kind forces it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const target = await boot();
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect((await designOf(target)).enabled).toBe(false);
    await target.restart(() => ({ kind: 'development' }));
    await target.services().licenses.load();
    expect(target.services().entitlement('ai').state).toBe('development');
    // The hosts still count.
    domains = ['www.example.com'];
    await target.services().licenses.load();
    expect(target.services().entitlement('ai').state).toBe('missing');
  });

  it('is never one with the production kind', async () => {
    const target = await boot({ license: () => ({ kind: 'production' }) });
    expect(target.services().entitlement('ai').state).toBe('missing');
  });
});

describe('reloading the hostnames', () => {
  const space = (url: string) => ({ name: 'Site', machineName: 'site', url });

  /** Runs `write` and counts the reloads it started. */
  const reloads = async (target: LicenseInstance, write: () => Promise<unknown>) => {
    const reload = vi.spyOn(target.services().licenses, 'reload');
    try {
      await write();
      return reload.mock.calls.length;
    } finally {
      reload.mockRestore();
    }
  };

  it('locks as soon as a space gets a public URL, and runs once it is gone', async () => {
    const target = await boot();
    const state = () => target.services().entitlement('ai').state;
    let id = '';
    const created = async () => {
      id = (await target.api.spaces.create(space('http://site.localhost:3200'), null)).id;
    };
    expect(await reloads(target, created)).toBe(1);
    expect(state()).toBe('development');

    const update = (data: { url?: string; name?: string }) => () =>
      target.api.spaces.update(id, data);
    expect(await reloads(target, update({ url: 'https://www.example.com' }))).toBe(1);
    expect(state()).toBe('missing');
    expect((await designOf(target)).enabled).toBe(false);
    expect(await reloads(target, update({ url: 'http://site.test' }))).toBe(1);
    expect(state()).toBe('development');
    // A write that keeps the URL reads nothing again.
    expect(await reloads(target, update({ name: 'Renamed' }))).toBe(0);

    await target.api.spaces.update(id, { url: 'https://www.example.com' });
    expect(state()).toBe('missing');
    expect(await reloads(target, () => target.api.spaces.delete(id))).toBe(1);
    expect(state()).toBe('development');
    expect((await designOf(target)).enabled).toBe(true);
  });

  it('locks as soon as a space with a public URL is created', async () => {
    const target = await boot();
    await target.api.spaces.create(space('https://www.example.com'), null);
    expect(target.services().entitlement('ai').state).toBe('missing');
  });

  it('locks as soon as a space gets a public API host, and runs once it is gone', async () => {
    const target = await boot();
    const state = () => target.services().entitlement('ai').state;
    const { id } = await target.api.spaces.create(space('http://site.localhost:3200'), null);
    let hostId = '';
    const add = async () => {
      hostId = (await target.api.apiHosts.create(id, 'api.example.com')).id;
    };
    expect(await reloads(target, add)).toBe(1);
    expect(state()).toBe('missing');
    expect((await designOf(target)).enabled).toBe(false);
    expect(await reloads(target, () => target.api.apiHosts.delete(id, hostId))).toBe(1);
    expect(state()).toBe('development');
    // A private one keeps the instance in development.
    expect(await reloads(target, () => target.api.apiHosts.replace(id, ['api.site.test']))).toBe(1);
    expect(state()).toBe('development');
  });

  it("reads a plugin's hostnames again on reload(), and tells the other processes", async () => {
    const target = await boot();
    const publish = vi.spyOn(target.api.manablox.plugin('license').channel('reload'), 'publish');
    domains = ['www.example.com'];
    expect(target.services().entitlement('ai').state).toBe('development');
    await target.services().reload();
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect(publish).toHaveBeenCalledWith({});
  });
});

describe('a development instance with a key', () => {
  it('activates it as development, as before', async () => {
    const target = await boot({ license: (server) => ({ keys: [server.addKey()] }) });
    expect(target.services().entitlement('ai')).toMatchObject({
      state: 'active',
      kind: 'development',
    });
    expect([...target.server.activations.values()][0]?.kind).toBe('development');
    expect(target.services().allowsHost('ai', 'www.example.com')).toBe(false);
    expect(bannerIds(target)).toEqual(['license.development']);
  });

  it('takes a production lease over development mode: no notice, every host', async () => {
    const target = await boot({
      license: (server) => ({ keys: [server.addKey({ products: ['ai'] })] }),
    });
    const [row] = target.services().licenses.overview().keys;
    await target.services().licenses.activate(row?.id ?? '', { kind: 'production' });
    expect(target.services().entitlement('ai')).toMatchObject({
      state: 'active',
      kind: 'production',
    });
    expect(target.services().allowsHost('ai', 'www.example.com')).toBe(true);
    expect(bannerIds(target)).toEqual([]);
  });
});
