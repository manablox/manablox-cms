import { LICENSE_PUBLIC_KEYS } from '@manablox/license';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LICENSE_SERVER, licenseConfig, portalOf } from '../src/server/config.js';
import { LicenseClient } from '../src/server/services/license/client.js';

const KEY = 'MBX-J06NP-P83GH-JX2NX-6ZWSQ-Z9ZDE';

describe('the plugin options', () => {
  it('fall back to the environment', () => {
    const config = licenseConfig(
      {},
      {
        MANABLOX_LICENSE_KEYS: ` ${KEY.toLowerCase()}, MBX-nope ,${KEY}`,
        MANABLOX_LICENSE_SERVER: 'https://licenses.example.com/api/',
        MANABLOX_LICENSE_KIND: 'development',
        MANABLOX_LICENSE_DEV_HOSTS: 'Preview.example.com, *.pr.example.com',
      },
    );
    expect(config).toMatchObject({
      keys: [KEY],
      malformed: ['MBX-nope'],
      server: 'https://licenses.example.com/api',
      portal: 'https://licenses.example.com',
      kind: 'development',
      devHosts: ['preview.example.com', '*.pr.example.com'],
    });
  });

  it('prefer the code options, with the defaults', () => {
    const config = licenseConfig(
      { keys: [], server: 'http://localhost:4100/api', portal: 'http://localhost:5173/' },
      { MANABLOX_LICENSE_KEYS: KEY, MANABLOX_LICENSE_SERVER: 'https://ignored.test' },
    );
    expect(config).toMatchObject({
      keys: [],
      server: 'http://localhost:4100/api',
      portal: 'http://localhost:5173',
      kind: 'auto',
    });
    expect(licenseConfig({}, {})).toMatchObject({
      server: DEFAULT_LICENSE_SERVER,
      portal: 'https://licenses.manablox.io',
    });
  });

  it('trust extra signing keys only from code, never from the environment', () => {
    const env = { MANABLOX_LICENSE_TRUSTED_KEYS: '{"evil":"x"}', MANABLOX_LICENSE_KEYS: '' };
    expect(licenseConfig({}, env).trustedKeys).toEqual(LICENSE_PUBLIC_KEYS);
    expect(licenseConfig({ trustedKeys: { test: 'abc' } }, env).trustedKeys).toEqual({
      test: 'abc',
      ...LICENSE_PUBLIC_KEYS,
    });
  });

  it('refuse a kind or server that cannot work', () => {
    expect(() => licenseConfig({}, { MANABLOX_LICENSE_KIND: 'hosted' })).toThrow(
      /MANABLOX_LICENSE_KIND/,
    );
    expect(() => licenseConfig({ server: 'not a url' }, {})).toThrow(/not a URL/);
  });

  it('derive the portal from the server', () => {
    expect(portalOf('https://licenses.manablox.io/api')).toBe('https://licenses.manablox.io');
    expect(portalOf('https://example.com/licenses/api/')).toBe('https://example.com/licenses');
    expect(portalOf('https://api.example.com')).toBe('https://api.example.com');
  });
});

describe('the license server client', () => {
  const answering = (status: number, body: unknown) =>
    new LicenseClient({
      server: 'https://licenses.test/api',
      fetch: async () => new Response(JSON.stringify(body), { status }),
    });
  const request = {
    key: KEY,
    instanceId: 'i',
    kind: 'production' as const,
    hostnames: [],
    versions: {},
  };

  it('maps the error codes to plugin errors, with their details', async () => {
    for (const [code, key, status] of [
      ['key.invalid', 'plugins.license.key.invalid', 400],
      ['key.revoked', 'plugins.license.key.revoked', 403],
      ['key.bound', 'plugins.license.key.bound', 409],
      ['trial.used', 'plugins.license.key.trialUsed', 409],
      ['subscription.inactive', 'plugins.license.subscription.inactive', 403],
      ['activation.notFound', 'plugins.license.activation.notFound', 404],
      ['request.invalid', 'plugins.license.request.invalid', 400],
      ['cliSession.notFound', 'plugins.license.cliSession.notFound', 404],
    ] as const) {
      await expect(
        answering(status, { error: { code, message: code } }).activate(request),
      ).rejects.toMatchObject({ key });
    }
    await expect(
      answering(429, {
        error: { code: 'rateLimited', message: '', details: { retryAfter: 30 } },
      }).activate(request),
    ).rejects.toMatchObject({
      key: 'plugins.license.rateLimited',
      details: [{ params: { retryAfter: 30 } }],
    });
    await expect(
      answering(409, {
        error: { code: 'seats.none', message: '', details: { activations: [{ id: 'a' }] } },
      }).activate(request),
    ).rejects.toMatchObject({
      key: 'plugins.license.key.noSeats',
      details: [{ params: { keyId: 'J06NP', activations: [{ id: 'a' }] } }],
    });
  });

  it('reports an unexpected answer and an unreachable server', async () => {
    await expect(answering(502, 'Bad gateway').activate(request)).rejects.toMatchObject({
      key: 'plugins.license.server.failed',
      details: [{ params: { status: 502 } }],
    });
    await expect(answering(201, { lease: 'x' }).activate(request)).rejects.toMatchObject({
      key: 'plugins.license.server.failed',
    });
    const down = new LicenseClient({
      server: 'https://licenses.test/api',
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      },
    });
    await expect(
      down.refresh('a', { refreshSecret: 's', hostnames: [], versions: {} }),
    ).rejects.toMatchObject({
      key: 'plugins.license.network',
      details: [{ params: { reason: 'ENOTFOUND' } }],
    });
  });
});
