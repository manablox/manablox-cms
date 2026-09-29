import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ManabloxError } from './errors.js';

/**
 * SSRF guard for requests to user-configured URLs (webhooks, plugins such as workflows and AI): no
 * private network, bounded redirects, capped response size.
 */

export interface SafeFetchOptions {
  /** Only for isolated installs that must reach internal hosts. */
  allowPrivateNetwork: boolean;
  /** Private hosts allowed anyway, as `host` or `host:port` (e.g. self-hosted AI). */
  allowHosts?: readonly string[] | undefined;
  maxResponseBytes: number;
  maxRedirects: number;
  /** Swapped in tests. */
  fetch?: typeof fetch;
  /** Swapped in tests; resolves a hostname to its addresses. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** IPv4 ranges an outbound request must not reach, per the RFCs. */
const PRIVATE_V4: readonly [cidr: string, why: string][] = [
  ['0.0.0.0/8', 'this network'],
  ['10.0.0.0/8', 'private'],
  ['100.64.0.0/10', 'carrier-grade NAT'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local, and with it 169.254.169.254'],
  ['172.16.0.0/12', 'private'],
  ['192.0.0.0/24', 'IETF protocol assignments'],
  ['192.0.2.0/24', 'documentation'],
  ['192.168.0.0/16', 'private'],
  ['198.18.0.0/15', 'benchmarking'],
  ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved, and 255.255.255.255 with it'],
];

function toUint32(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // `Number` would accept '0x7f' and ' 12'.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inCidr(value: number, cidr: string): boolean {
  const [network, bits] = cidr.split('/') as [string, string];
  const base = toUint32(network);
  if (base === null) return false;
  const width = Number(bits);
  if (width === 0) return true;
  // Unsigned shift: a signed one would sign-extend a /1 mask.
  const mask = (0xffff_ffff << (32 - width)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const value = toUint32(address);
    // Unparseable addresses fail closed.
    if (value === null) return true;
    return PRIVATE_V4.some(([cidr]) => inCidr(value, cidr));
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::1') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value)) return true;
    // IPv4-mapped IPv6.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

const defaultResolve = async (hostname: string): Promise<string[]> => {
  const results = await lookup(hostname, { all: true });
  return results.map((entry) => entry.address);
};

/** Refuses non-http(s) URLs and hosts resolving to private addresses. */
export async function assertAllowedUrl(
  url: URL,
  options: Pick<SafeFetchOptions, 'allowPrivateNetwork' | 'allowHosts' | 'resolve'>,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ManabloxError.badRequest('net.blocked', { url: url.href, reason: 'protocol' });
  }
  if (options.allowPrivateNetwork) return;
  if (isAllowedHost(url, options.allowHosts)) return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolveOrRefuse(host, options);
  const blocked = addresses.find(isPrivateAddress);
  if (blocked) {
    throw ManabloxError.badRequest('net.blocked', { url: url.href, address: blocked });
  }
}

/**
 * Whether `allowHosts` lists this host (`host` for any port, `host:port` for one). Compares
 * the parsed hostname so userinfo tricks and trailing dots cannot match.
 */
export function isAllowedHost(url: URL, allowHosts: readonly string[] | undefined): boolean {
  if (!allowHosts?.length) return false;
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return allowHosts.some((entry) => {
    const value = entry.trim().toLowerCase();
    if (!value) return false;
    // Only `[addr]:port` gives an IPv6 address a port.
    const bareV6 = !value.startsWith('[') && value.split(':').length > 2;
    const match = bareV6 ? [value, value] : /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(value);
    if (!match) return false;
    const [, name, wantedPort] = match;
    return name === host && (!wantedPort || wantedPort === port);
  });
}

async function resolveOrRefuse(
  host: string,
  options: Pick<SafeFetchOptions, 'resolve'>,
): Promise<string[]> {
  try {
    return await (options.resolve ?? defaultResolve)(host);
  } catch {
    // Unresolvable names fail closed.
    throw ManabloxError.badRequest('net.blocked', { host, reason: 'unresolved' });
  }
}

/** A safe fetch from instance config; `overrides` for callers with other limits. */
export function configuredSafeFetch(
  config: {
    allowPrivateNetwork: boolean;
    maxResponseBytes: number;
    maxRedirects: number;
    allowHosts?: readonly string[] | undefined;
  },
  overrides: Partial<SafeFetchOptions> = {},
): typeof fetch {
  return createSafeFetch({
    allowPrivateNetwork: config.allowPrivateNetwork,
    maxResponseBytes: config.maxResponseBytes,
    maxRedirects: config.maxRedirects,
    ...(config.allowHosts ? { allowHosts: config.allowHosts } : {}),
    ...overrides,
  });
}

/**
 * `fetch` with the guards above: each redirect hop is checked and the body is capped.
 * Known gap: DNS may resolve differently between check and connect.
 */
export function createSafeFetch(options: SafeFetchOptions): typeof fetch {
  const inner = options.fetch ?? globalThis.fetch;

  return async function safeFetch(input, init) {
    const request = new Request(input as string | URL | Request, init);
    let url = new URL(request.url);
    let current = request;

    for (let hop = 0; ; hop++) {
      await assertAllowedUrl(url, options);
      const response = await inner(current, { redirect: 'manual' });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return capBody(response, options.maxResponseBytes, url);
      }
      if (hop >= options.maxRedirects) {
        throw ManabloxError.badRequest('net.tooManyRedirects', {
          url: url.href,
          max: options.maxRedirects,
        });
      }

      const location = response.headers.get('location');
      if (!location) return capBody(response, options.maxResponseBytes, url);
      const next = new URL(location, url);
      // 303, and 301/302 on non-GET, continue as a bodiless GET, as browsers do.
      const drops = response.status === 303 || (response.status !== 307 && response.status !== 308);
      current = new Request(next, {
        method: drops && current.method !== 'GET' ? 'GET' : current.method,
        headers: stripAuthAcrossHosts(current.headers, url, next),
        ...(drops || current.method === 'GET' ? {} : { body: await current.clone().text() }),
      });
      url = next;
    }
  };
}

/** Drops credentials on cross-origin redirects. */
function stripAuthAcrossHosts(headers: Headers, from: URL, to: URL): Headers {
  if (from.origin === to.origin) return headers;
  const copy = new Headers(headers);
  copy.delete('authorization');
  copy.delete('cookie');
  return copy;
}

/** Reads at most `max` bytes; fails instead of truncating. */
async function capBody(response: Response, max: number, url: URL): Promise<Response> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    throw ManabloxError.badRequest('net.tooLarge', { url: url.href, max });
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw ManabloxError.badRequest('net.tooLarge', { url: url.href, max });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
