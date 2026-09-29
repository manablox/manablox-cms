import { createHash, timingSafeEqual } from 'node:crypto';
import type { BlockList } from 'node:net';
import { type ControlApiConfig, ManabloxError } from '@manablox/core';
import type { MiddlewareHandler } from 'hono';
import { errorResponse } from '../errors.js';
import { clientIp, ipInList, ipList } from '../middleware/client-ip.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Parses `CONTROL_API_ALLOWED_IPS` entries (addresses or CIDR ranges); throws on a bad one. */
export function allowedIpList(entries: readonly string[]): BlockList {
  return ipList(entries, 'config.control.allowedIpInvalid', ['control', 'allowedIps']);
}

/**
 * `Authorization: Bearer <key>` against the current and the next key, compared as SHA-256
 * digests in constant time; with `allowedIps`, the client IP must be in the list as well.
 */
export function controlAuth(config: ControlApiConfig): MiddlewareHandler {
  const keys = [config.apiKey, config.nextApiKey]
    .filter((key): key is string => Boolean(key))
    .map(digest);
  const allowed = config.allowedIps?.length ? allowedIpList(config.allowedIps) : null;

  return async (c, next) => {
    if (allowed && !ipInList(allowed, clientIp(c))) {
      return errorResponse(c, ManabloxError.forbidden('control.ipNotAllowed'));
    }
    const header = c.req.header('authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? '';
    const given = digest(token);
    let match = false;
    for (const key of keys) match = timingSafeEqual(given, key) || match;
    if (!token || !match) {
      c.header('www-authenticate', 'Bearer realm="control"');
      return errorResponse(c, ManabloxError.unauthorized());
    }
    await next();
  };
}
