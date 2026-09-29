import { decryptSecret } from '@manablox/core/node';
import { keyId } from '@manablox/license';
import { afterEach, describe, expect, it } from 'vitest';
import { licenseRepos } from '../src/server/db/index.js';
import { bootLicense, type LicenseInstance, SELLER_LAPSE } from './helpers/boot.js';
import { DAY, T0 } from './helpers/leases.js';

const HOUR_MS = 60 * 60_000;
const SECRET = 'license-plugin-secret-0123456789';

let instance: LicenseInstance | null = null;
afterEach(async () => {
  await instance?.close();
  instance = null;
});

async function boot(
  options: { keys?: (server: LicenseInstance['server']) => string[]; public?: boolean } = {},
) {
  instance = await bootLicense('service', {
    license: (server) => ({ keys: options.keys?.(server) ?? [], kind: 'production' }),
    ...(options.public ? { public: true } : {}),
  });
  // The boot reconciles in the background; this one waits for it.
  await instance.services().licenses.reconcile();
  return instance;
}

const rows = (target: LicenseInstance) => licenseRepos(target.api.repos).list();
const designOn = async (target: LicenseInstance) =>
  (await target.api.manablox.controls.feature(null, SELLER_LAPSE)).enabled;

describe('activation', () => {
  it('activates the configured keys at boot and stores the lease and a sealed secret', async () => {
    let key = '';
    const target = await boot({
      keys: (server) => {
        key = server.addKey();
        return [key];
      },
    });
    const [row] = await rows(target);
    const [activation] = [...target.server.activations.values()];
    expect(row).toMatchObject({
      source: 'environment',
      keyId: keyId(key),
      activationId: activation?.id,
      kind: 'production',
      keyEnc: null,
      lastError: null,
    });
    // The key is matched by its hash and never stored; the refresh secret is sealed.
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row?.refreshSecret).not.toBe(activation?.secret);
    expect(decryptSecret(row?.refreshSecret ?? '', SECRET)).toBe(activation?.secret);
    expect(activation).toMatchObject({
      instanceId: target.api.manablox.instance.id,
      kind: 'production',
      hostnames: ['localhost'],
      versions: { manablox: expect.any(String), seller: expect.any(String) },
      name: `localhost (${target.api.manablox.instance.id.slice(0, 6)})`,
    });

    expect(target.services().entitlement('ai')).toMatchObject({ state: 'active' });
    expect(await designOn(target)).toBe(true);
  });

  it('locks the lapse set without a key, and shows why', async () => {
    const target = await boot();
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect(await target.api.manablox.controls.feature(null, SELLER_LAPSE)).toMatchObject({
      enabled: false,
      presentation: 'locked',
      message: 'Add a license key for the AI plugin.',
      link: 'https://licenses.test/buy?products=ai',
    });
    // The plugin itself stays on: only its lapse set locks.
    expect(await target.api.manablox.plugins.isOn('seller', null)).toBe(true);
  });

  it('records a missing seat with the instances holding them, and retries later', async () => {
    const target = await boot();
    const key = target.server.addKey({ quantity: 1 });
    await target.server.fetch('https://licenses.test/api/v1/activations', {
      method: 'POST',
      body: JSON.stringify({
        key,
        instanceId: 'other',
        kind: 'production',
        hostnames: ['a.example.com'],
        versions: {},
        name: 'Other',
      }),
    });
    const view = await target.services().licenses.addKey(key);
    expect(view.error).toMatchObject({
      key: 'plugins.license.key.noSeats',
      message: expect.stringContaining(keyId(key)),
      activations: [expect.objectContaining({ name: 'Other', hostnames: ['a.example.com'] })],
    });
    expect(target.services().entitlement('ai').state).toBe('missing');
    const [row] = await rows(target);
    expect(row).toMatchObject({ failures: 1, activationId: null });
    expect(row?.retryAt?.getTime()).toBe(target.clock.now + 6 * HOUR_MS);

    // The seat frees up; the next run after the backoff activates.
    for (const activation of target.server.activations.values()) activation.deactivated = true;
    await target.services().licenses.maintain();
    expect((await rows(target))[0]?.activationId).toBeNull();
    target.clock.now += 6 * HOUR_MS;
    await target.services().licenses.maintain();
    expect((await rows(target))[0]?.activationId).toEqual(expect.any(String));
    expect(target.services().entitlement('ai').state).toBe('active');
  });

  it('refuses a malformed, unknown or duplicate key', async () => {
    const target = await boot();
    const { licenses } = target.services();
    expect(() => licenses.addKey('MBX-nope')).toThrow(
      expect.objectContaining({ key: 'plugins.license.key.malformed' }),
    );
    const unknown = await licenses.addKey('MBX-J06NP-P83GH-JX2NX-6ZWSQ-Z9ZDE');
    expect(unknown.error?.key).toBe('plugins.license.key.invalid');
    await expect(licenses.addKey('mbx j06np p83gh jx2nx 6zwsq z9zde')).rejects.toMatchObject({
      key: 'plugins.license.key.duplicate',
    });
    // An unknown key is not tried again on its own.
    const calls = target.server.calls.length;
    target.clock.now += 2 * DAY * 1000;
    await licenses.maintain();
    expect(target.server.calls.length).toBe(calls);
  });
});

describe('refresh', () => {
  it('refreshes a day-old lease with the rotated secret, and not before', async () => {
    const target = await boot({ keys: (server) => [server.addKey()] });
    const { licenses } = target.services();
    const [activation] = [...target.server.activations.values()];
    const first = activation?.secret;

    target.clock.now += 23 * HOUR_MS;
    await licenses.maintain();
    expect(target.server.calls.filter((call) => call.path.endsWith('/refresh'))).toHaveLength(0);

    target.clock.now += 2 * HOUR_MS;
    await licenses.maintain();
    const refreshes = target.server.calls.filter((call) => call.path.endsWith('/refresh'));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.body.refreshSecret).toBe(first);
    const [row] = await rows(target);
    expect(decryptSecret(row?.refreshSecret ?? '', SECRET)).toBe(activation?.secret);
    expect(activation?.secret).not.toBe(first);
    expect(row?.refreshedAt?.getTime()).toBe(target.clock.now);
    expect(row?.leaseExp?.getTime()).toBe(target.clock.now + 14 * DAY * 1000);
  });

  it('backs off while the server is down, and warns before the lease runs out', async () => {
    // Paid far ahead; the lease runs 14 days.
    const target = await boot({ keys: (server) => [server.addKey({ periodEnd: T0 + 90 * DAY })] });
    const { licenses } = target.services();
    target.server.state.down = true;
    target.clock.now += 12 * DAY * 1000;
    await licenses.maintain();
    const [row] = await rows(target);
    expect(row).toMatchObject({ failures: 1, lastError: { key: 'plugins.license.network' } });
    expect(target.services().entitlement('ai').state).toBe('expiring');
    const banners = target.api.manablox.ceilings.current().banners;
    expect(banners.map((banner) => banner.id)).toEqual(['license.ai.expiring']);
    // Nothing locks yet.
    expect(await designOn(target)).toBe(true);

    const calls = target.server.calls.length;
    target.clock.now += 5 * HOUR_MS;
    await licenses.maintain();
    expect(target.server.calls.length).toBe(calls);
    target.clock.now += HOUR_MS;
    await licenses.maintain();
    expect(target.server.calls.length).toBe(calls + 1);
    expect((await rows(target))[0]?.failures).toBe(2);

    // The lease runs out: the product lapses, lazily, on the next read.
    target.clock.now += 2 * DAY * 1000;
    expect(await designOn(target)).toBe(false);
    expect(target.services().entitlement('ai').state).toBe('lapsed');

    target.server.state.down = false;
    await licenses.refresh(row?.id ?? '');
    expect(await designOn(target)).toBe(true);
  });

  it('marks a conflict, keeps the lease until it runs out, and moves it back on activation', async () => {
    const target = await boot({ keys: (server) => [server.addKey()] });
    const { licenses } = target.services();
    const [activation] = [...target.server.activations.values()];
    // A copy of the instance refreshed twice: this one's secret is stale.
    if (activation) {
      activation.secret = 'rs_elsewhere';
      activation.previous = null;
    }
    const [row] = await rows(target);
    await expect(licenses.refresh(row?.id ?? '')).rejects.toMatchObject({
      key: 'plugins.license.activation.conflict',
    });
    const [conflicted] = await rows(target);
    expect(conflicted?.conflictAt).toBeInstanceOf(Date);
    expect(conflicted?.lease).toBe(row?.lease);
    expect(target.services().entitlement('ai').state).toBe('conflict');
    expect(await designOn(target)).toBe(true);
    // No automatic refresh after a conflict.
    const calls = target.server.calls.length;
    target.clock.now += 2 * DAY * 1000;
    await licenses.maintain();
    expect(target.server.calls.length).toBe(calls);

    await licenses.activate(row?.id ?? '');
    expect((await rows(target))[0]?.conflictAt).toBeNull();
    expect(target.services().entitlement('ai').state).toBe('active');
  });
});

describe('deactivation and reconciling', () => {
  it('frees the seat, drops the lease and stays deactivated', async () => {
    const target = await boot({ keys: (server) => [server.addKey()] });
    const { licenses } = target.services();
    const [row] = await rows(target);
    const view = await licenses.deactivate(row?.id ?? '');
    expect(view).toMatchObject({ activated: false, deactivated: true, state: null });
    expect([...target.server.activations.values()][0]?.deactivated).toBe(true);
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect(await designOn(target)).toBe(false);

    await licenses.reconcile();
    await licenses.maintain();
    expect((await rows(target))[0]?.activationId).toBeNull();

    // Activating again takes a seat again.
    await licenses.activate(row?.id ?? '');
    expect(target.services().entitlement('ai').state).toBe('active');
  });

  it('deactivates a key that left the config, here at once and on the server', async () => {
    let first = '';
    const target = await boot({
      keys: (server) => {
        first = server.addKey();
        return [first];
      },
    });
    const second = target.server.addKey({ products: ['website'] });
    await target.restart(() => ({ keys: [second], kind: 'production' }));
    await target.services().licenses.reconcile();

    const list = await rows(target);
    expect(list.map((row) => row.keyId)).toEqual([keyId(second)]);
    const byKey = new Map(
      [...target.server.activations.values()].map((activation) => [activation.key, activation]),
    );
    expect(byKey.get(first)?.deactivated).toBe(true);
    expect(byKey.get(second)?.deactivated).toBe(false);
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect(target.services().entitlement('website').state).toBe('active');
  });

  it('removes an admin key but never an environment key', async () => {
    const target = await boot({ keys: (server) => [server.addKey()] });
    const { licenses } = target.services();
    const added = await licenses.addKey(target.server.addKey());
    const [environment] = await rows(target);
    await expect(licenses.removeKey(environment?.id ?? '')).rejects.toMatchObject({
      key: 'plugins.license.key.fromEnvironment',
    });
    await licenses.removeKey(added.id);
    expect((await rows(target)).map((row) => row.source)).toEqual(['environment']);
    const freed = [...target.server.activations.values()].filter((entry) => entry.deactivated);
    expect(freed).toHaveLength(1);
  });

  it('tells the other processes, which read the leases again', async () => {
    const target = await boot({ public: true });
    const pub = target.pub;
    if (!pub) throw new Error('no public process');
    // Without Redis there is no channel; the public process reads again on its own schedule.
    expect(target.services(pub).entitlement('ai').state).toBe('missing');
    await target.services().licenses.addKey(target.server.addKey());
    await target.services(pub).licenses.load();
    expect(target.services(pub).entitlement('ai').state).toBe('active');
    expect((await pub.manablox.controls.feature(null, SELLER_LAPSE)).enabled).toBe(true);
  });
});

describe('the development kind', () => {
  it('activates as development on private hosts, and as production on a public one', async () => {
    instance = await bootLicense('service-kind', {
      license: (server) => ({ keys: [server.addKey()] }),
    });
    await instance.services().licenses.reconcile();
    expect((await rows(instance))[0]?.kind).toBe('development');
    expect(instance.services().entitlement('ai')).toMatchObject({
      state: 'active',
      kind: 'development',
    });
    const banners = instance.api.manablox.ceilings.current().banners;
    expect(banners).toEqual([
      expect.objectContaining({ id: 'license.development', level: 'info' }),
    ]);
    // A development lease serves private hosts only.
    expect(instance.services().allowsHost('ai', 'localhost:3000')).toBe(true);
    expect(instance.services().allowsHost('ai', 'www.example.com')).toBe(false);
    expect(instance.services().allowsHost('website', 'www.example.com')).toBe(false);
    await instance.close();

    instance = await bootLicense('service-kind-public', {
      license: (server) => ({ keys: [server.addKey()] }),
      config: { server: { publicUrl: 'https://cms.example.com' } },
    });
    await instance.services().licenses.reconcile();
    expect((await rows(instance))[0]?.kind).toBe('production');
    expect(instance.services().allowsHost('ai', 'www.example.com')).toBe(true);
  });

  it('covers nothing once the instance has a public hostname', async () => {
    instance = await bootLicense('service-kind-forced', {
      license: (server) => ({ keys: [server.addKey()], kind: 'development' }),
      config: { server: { publicUrl: 'https://cms.example.com' } },
    });
    await instance.services().licenses.reconcile();
    expect((await rows(instance))[0]?.kind).toBe('development');
    expect(instance.services().entitlement('ai')).toMatchObject({
      state: 'missing',
      reason: 'developmentOnPublicHost',
    });
    expect(await instance.api.manablox.controls.feature(null, SELLER_LAPSE)).toMatchObject({
      enabled: false,
      message: 'A public domain needs a production license for the AI plugin.',
    });
  });
});

describe('the instance hostnames', () => {
  it("counts the spaces' URLs and API hosts, so a public one ends a development lease", async () => {
    instance = await bootLicense('service-hosts', {
      license: (server) => ({ keys: [server.addKey()], kind: 'development' }),
    });
    const target = instance;
    const { licenses } = target.services();
    await licenses.reconcile();
    expect(target.services().entitlement('ai').state).toBe('active');

    const space = await target.api.repos.spaces.create({
      name: 'Local',
      machineName: 'local',
      url: 'http://site.localhost:3200',
      defaultLocale: 'en',
      locales: ['en'],
    });
    await target.api.repos.spaceApiHosts.create(space.id, { hostname: 'api.test' });
    await licenses.load();
    expect(target.services().entitlement('ai').state).toBe('active');

    await target.api.repos.spaceApiHosts.create(space.id, { hostname: 'api.example.com' });
    await licenses.load();
    expect(target.services().entitlement('ai')).toMatchObject({
      state: 'missing',
      reason: 'developmentOnPublicHost',
    });

    await target.api.repos.spaces.create({
      name: 'Public',
      machineName: 'public',
      url: 'https://www.example.org',
      defaultLocale: 'en',
      locales: ['en'],
    });
    target.clock.now += 25 * HOUR_MS;
    await licenses.maintain();
    const refresh = target.server.calls.findLast((call) => call.path.endsWith('/refresh'));
    expect(refresh?.body.hostnames).toEqual(
      expect.arrayContaining(['site.localhost', 'api.test', 'api.example.com', 'www.example.org']),
    );
  });
});

describe('an activation the license server no longer knows', () => {
  it('drops the lease at once, keeps the key and activates again on request', async () => {
    const target = await boot({ keys: (server) => [server.addKey()] });
    const { licenses } = target.services();
    target.server.activations.clear();

    target.clock.now += 25 * HOUR_MS;
    await licenses.maintain();
    const [row] = await rows(target);
    expect(row).toMatchObject({ activationId: null, lease: null, refreshSecret: null });
    expect(row?.lastError?.key).toBe('plugins.license.activation.notFound');
    expect(target.services().entitlement('ai').state).toBe('missing');
    expect(await designOn(target)).toBe(false);

    // Not on its own: someone activates it again.
    await licenses.maintain();
    expect((await rows(target))[0]?.activationId).toBeNull();
    await licenses.activate(row?.id ?? '');
    expect(target.services().entitlement('ai').state).toBe('active');
  });
});

describe('hosted licenses', () => {
  it('are managed by Manablox Cloud and warn about nothing but a lock', async () => {
    const target = await boot({
      keys: (server) => [server.addKey({ hosted: true, status: 'pastDue' })],
    });
    const { licenses } = target.services();
    expect(target.services().entitlement('ai')).toMatchObject({ state: 'pastDue', kind: 'hosted' });
    expect(licenses.overview().managed).toBe(true);
    expect(target.api.manablox.ceilings.current().banners).toEqual([]);

    // Its lease runs out without a refresh: the lock shows.
    target.server.state.down = true;
    target.clock.now += 15 * DAY * 1000;
    await licenses.load();
    expect(target.services().entitlement('ai').state).toBe('lapsed');
    expect(target.api.manablox.ceilings.current().banners).toEqual([
      expect.objectContaining({ id: 'license.ai.lapsed', level: 'danger' }),
    ]);
  });

  it('are not managed while any key is of another kind', async () => {
    const target = await boot({ keys: (server) => [server.addKey({ hosted: true })] });
    await target.services().licenses.addKey(target.server.addKey());
    expect(target.services().licenses.overview().managed).toBe(false);
  });
});
