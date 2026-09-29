import { BlockList, isIP } from 'node:net';
import { type ErrorKey, ManabloxError } from '@manablox/core';
import type { Context } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by `clientIpMiddleware`. */
    clientIp?: string;
  }
}

/** Parses addresses and CIDR ranges; throws `errorKey` on a bad entry. */
export function ipList(
  entries: readonly string[],
  errorKey: ErrorKey,
  path: readonly (string | number)[],
): BlockList {
  const list = new BlockList();
  for (const [index, entry] of entries.entries()) {
    const [address = '', prefix, extra] = entry.trim().split('/');
    const family = isIP(address);
    const bits = prefix === undefined ? null : Number(prefix);
    const max = family === 6 ? 128 : 32;
    const valid =
      family !== 0 &&
      extra === undefined &&
      (bits === null || (/^\d+$/.test(prefix ?? '') && bits >= 0 && bits <= max));
    if (!valid) {
      throw ManabloxError.validation([{ key: errorKey, path: [...path, index] }], 'config.invalid');
    }
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (bits === null) list.addAddress(address, type);
    else list.addSubnet(address, bits, type);
  }
  return list;
}

/** Whether `ip` is in the list; IPv4-mapped IPv6 addresses count as IPv4. */
export function ipInList(list: BlockList, ip: string | null | undefined): boolean {
  if (!ip) return false;
  const address = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
  const family = isIP(address);
  if (family === 0) return false;
  return list.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** The TCP peer's address, when the server exposes it. */
function socketAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

/**
 * Resolves the client IP. With `trusted` the headers count only when the peer is in the list,
 * and `X-Forwarded-For` is walked from the right past trusted hops. Without it every peer's
 * headers count. Falls back to the socket address, then `anonymous`.
 */
export function clientIpResolver(trusted: BlockList | null): (c: Context) => string {
  return (c) => {
    const header = (name: string) => c.req.header(name)?.trim() || undefined;
    const peer = socketAddress(c);
    if (!trusted) {
      return (
        header('cf-connecting-ip') ??
        header('x-forwarded-for')?.split(',')[0]?.trim() ??
        header('x-real-ip') ??
        peer ??
        'anonymous'
      );
    }
    if (!ipInList(trusted, peer)) return peer ?? 'anonymous';
    const cloudflare = header('cf-connecting-ip');
    if (cloudflare) return cloudflare;
    const hops = (header('x-forwarded-for') ?? '')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    for (let index = hops.length - 1; index >= 0; index--) {
      const hop = hops[index] as string;
      if (!ipInList(trusted, hop)) return hop;
    }
    return hops[0] ?? header('x-real-ip') ?? peer ?? 'anonymous';
  };
}

const untrusted = clientIpResolver(null);

/** The IP `clientIpMiddleware` resolved, else from every peer's headers. */
export function clientIp(c: Context): string {
  return c.get('clientIp') ?? untrusted(c);
}

let warned = false;

/** `server.trustedProxies` as a list; `null` while unset, with a warning once in production. */
export function trustedProxyList(
  entries: readonly string[] | undefined,
  logger: { warn: (obj: object, msg: string) => void },
): BlockList | null {
  const path = ['server', 'trustedProxies'];
  if (entries) return ipList(entries, 'config.server.trustedProxyInvalid', path);
  if (process.env.NODE_ENV === 'production' && !warned) {
    warned = true;
    logger.warn(
      {},
      'TRUSTED_PROXIES is not set: client IPs are read from forwarding headers of any peer',
    );
  }
  return null;
}
