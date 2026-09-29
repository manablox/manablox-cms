import { isIP } from 'node:net';

/** Names under these suffixes never resolve on the public internet. */
const PRIVATE_SUFFIXES = ['.localhost', '.test', '.local', '.internal'];

/**
 * The hostname of a URL or a `Host` header, lowercased, without port, brackets or a
 * trailing dot; `''` when there is none.
 */
export function hostnameOf(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('://')) {
    try {
      return new URL(raw).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    } catch {
      return '';
    }
  }
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : '';
  }
  // `host:port`; a bare IPv6 address has more than one colon.
  const colons = raw.split(':').length - 1;
  return (colons === 1 ? raw.slice(0, raw.indexOf(':')) : raw).replace(/\.$/, '');
}

function privateV4(address: string): boolean {
  const [a = -1, b = -1] = address.split('.').map(Number);
  return (
    a === 127 || // loopback
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || // RFC 1918
    (a === 169 && b === 254) // link-local
  );
}

function privateV6(address: string): boolean {
  if (address === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return privateV4(mapped[1]);
  // Link-local fe80::/10 and unique-local fc00::/7.
  return /^fe[89ab]/.test(address) || /^f[cd]/.test(address);
}

/** An extra host: a hostname, or `*.` and a suffix. */
function matches(hostname: string, pattern: string): boolean {
  const lower = pattern.trim().toLowerCase();
  if (lower.startsWith('*.')) return hostname.endsWith(lower.slice(1));
  return hostname === lower;
}

/**
 * Whether a host is private, so a development activation may serve it: `localhost` and
 * names under `.localhost`, `.test`, `.local` and `.internal`, loopback, RFC 1918,
 * link-local and unique-local addresses, and the `extraHosts` (such as preview hosts, each
 * a hostname or `*.suffix`). Takes a hostname, a `Host` header with or without port
 * (`[::1]:3000` for IPv6) or a URL. An empty or unreadable one is public.
 */
export function isPrivateHostname(host: string, extraHosts: readonly string[] = []): boolean {
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  if (hostname === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return true;
  }
  const version = isIP(hostname);
  if (version === 4) return privateV4(hostname);
  if (version === 6) return privateV6(hostname);
  return extraHosts.some((pattern) => matches(hostname, pattern));
}
