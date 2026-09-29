import { describe, expect, it } from 'vitest';
import { ManabloxError } from '../src/errors.js';
import { createSafeFetch, isPrivateAddress } from '../src/net.node.js';

/** Requests to user-configured URLs are untrusted: metadata service, inward-resolving names, endless bodies. */

const guarded = (
  responder: (url: string) => Response,
  resolve: Record<string, string[]> = {},
  extra: Partial<Parameters<typeof createSafeFetch>[0]> = {},
) =>
  createSafeFetch({
    allowPrivateNetwork: false,
    maxResponseBytes: 1000,
    maxRedirects: 2,
    fetch: (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      return responder(url);
    }) as typeof fetch,
    resolve: async (host) => resolve[host] ?? ['93.184.216.34'],
    ...extra,
  });

const ok = () => new Response('hello', { status: 200 });

describe('isPrivateAddress', () => {
  it('knows the addresses an outbound call must not reach', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // the cloud metadata service
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      // Special-purpose ranges.
      '100.64.0.1', // carrier-grade NAT, which several clouds use internally
      '100.127.255.255',
      '192.0.2.1', // the documentation ranges: reserved, so never a real destination
      '198.51.100.1',
      '203.0.113.1',
      '198.18.0.1', // benchmarking
      '240.0.0.1', // reserved
      '255.255.255.255',
      '224.0.0.1', // multicast
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('refuses an address it cannot parse rather than letting it through', () => {
    // An octet form it cannot read must not default to public.
    expect(isPrivateAddress('999.1.1.1')).toBe(false); // not an IP at all, so a hostname
    expect(isPrivateAddress('0x7f.0.0.1')).toBe(false);
  });

  it('leaves the public internet alone', () => {
    for (const address of [
      '93.184.216.34',
      '8.8.8.8',
      '172.32.0.1',
      '172.15.255.255', // just below the private /12
      '100.63.255.255', // just below the CGNAT /10
      '100.128.0.0', // just above it
      '11.0.0.1',
      '2606:2800:220:1::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('createSafeFetch', () => {
  it('refuses a host that resolves inwards, and one given as an address', async () => {
    const fetch = guarded(ok, { 'internal.test': ['10.0.0.5'] });
    await expect(fetch('https://internal.test/x')).rejects.toMatchObject({
      key: 'net.blocked',
    });
    await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      key: 'net.blocked',
    });
  });

  it('refuses a name that does not resolve, and a protocol that is not http', async () => {
    const fetch = createSafeFetch({
      allowPrivateNetwork: false,
      maxResponseBytes: 1000,
      maxRedirects: 2,
      fetch: (async () => ok()) as typeof fetch,
      resolve: async () => {
        throw new Error('NXDOMAIN');
      },
    });
    await expect(fetch('https://nowhere.test/')).rejects.toMatchObject({
      key: 'net.blocked',
    });
    await expect(fetch('file:///etc/passwd')).rejects.toMatchObject({
      key: 'net.blocked',
    });
  });

  it('lets the public internet through', async () => {
    const fetch = guarded(ok);
    const response = await fetch('https://example.test/x');
    expect(await response.text()).toBe('hello');
  });

  it('checks every redirect hop, not only the first', async () => {
    const fetch = guarded(
      (url) =>
        url.includes('start')
          ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.9/admin' } })
          : ok(),
      { 'redirector.test': ['93.184.216.34'] },
    );
    await expect(fetch('https://redirector.test/start')).rejects.toMatchObject({
      key: 'net.blocked',
    });
  });

  it('gives up after too many redirects', async () => {
    const fetch = guarded(
      () =>
        new Response(null, { status: 302, headers: { location: 'https://example.test/again' } }),
    );
    await expect(fetch('https://example.test/start')).rejects.toMatchObject({
      key: 'net.tooManyRedirects',
    });
  });

  it('drops the credential when a redirect crosses to another origin', async () => {
    const seen: Array<[string, string | null]> = [];
    const fetch = createSafeFetch({
      allowPrivateNetwork: true,
      maxResponseBytes: 1000,
      maxRedirects: 2,
      fetch: (async (input: string | URL | Request) => {
        const request = input as Request;
        seen.push([request.url, request.headers.get('authorization')]);
        return request.url.includes('start')
          ? new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/x' } })
          : ok();
      }) as typeof fetch,
    });
    await fetch('https://example.test/start', { headers: { authorization: 'Bearer s3cret' } });
    expect(seen).toEqual([
      ['https://example.test/start', 'Bearer s3cret'],
      ['https://elsewhere.test/x', null],
    ]);
  });

  it('refuses an answer larger than the cap, declared or not', async () => {
    const declared = guarded(() => new Response('x', { headers: { 'content-length': '9999999' } }));
    await expect(declared('https://example.test/big')).rejects.toMatchObject({
      key: 'net.tooLarge',
    });

    const streamed = guarded(() => new Response('y'.repeat(5000)));
    await expect(streamed('https://example.test/big')).rejects.toMatchObject({
      key: 'net.tooLarge',
    });
  });

  it('lets an internal address through when the instance says so', async () => {
    const fetch = guarded(ok, {}, { allowPrivateNetwork: true });
    expect((await fetch('http://127.0.0.1:9000/health')).status).toBe(200);
  });

  it('reports the block as a typed error, not a bare throw', async () => {
    const fetch = guarded(ok, { 'internal.test': ['192.168.0.1'] });
    const failure = await fetch('https://internal.test/').catch((error: unknown) => error);
    expect(ManabloxError.is(failure)).toBe(true);
    expect((failure as ManabloxError).details[0]?.params).toMatchObject({
      address: '192.168.0.1',
    });
  });
});

describe('allowHosts', () => {
  const inward = { ollama: ['172.18.0.5'], other: ['172.18.0.6'] };

  it('lets a named self-hosted endpoint through, and nothing else on the network', async () => {
    const fetch = guarded(ok, inward, { allowHosts: ['ollama:11434', '10.0.0.9'] });
    await expect(fetch('http://ollama:11434/v1/models')).resolves.toBeInstanceOf(Response);
    await expect(fetch('http://10.0.0.9:8000/v1/models')).resolves.toBeInstanceOf(Response);
    // Another port on a named host, and another host, are still refused.
    await expect(fetch('http://ollama:22/')).rejects.toMatchObject({ key: 'net.blocked' });
    await expect(fetch('http://other:11434/')).rejects.toMatchObject({
      key: 'net.blocked',
    });
  });

  it('is not fooled by credentials in the URL or a bare IPv6 entry', async () => {
    const fetch = guarded(ok, inward, { allowHosts: ['ollama', '::1'] });
    // A URL carrying credentials never becomes a request at all.
    await expect(fetch('http://ollama@other:11434/')).rejects.toThrow();
    await expect(fetch('http://[::1]:8080/')).resolves.toBeInstanceOf(Response);
  });
});
