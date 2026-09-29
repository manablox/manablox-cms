import type { CspConfig } from '@manablox/core';
import type { MiddlewareHandler } from 'hono';

/**
 * CSP for the admin's HTML responses only. `style-src` allows inline styles for Vue
 * transitions; `frame-src` and `img-src` are operator-configured (see `CspConfig`).
 */
export function contentSecurityPolicy(
  config: Required<Omit<CspConfig, 'reportUri'>> & Pick<CspConfig, 'reportUri'>,
  scriptHashes: readonly string[] = [],
): MiddlewareHandler {
  const header = config.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  const value = policy(config, scriptHashes);

  return async (c, next) => {
    await next();
    if (!c.res.ok) return;
    if (!c.res.headers.get('content-type')?.includes('text/html')) return;
    c.res.headers.set(header, value);
  };
}

/** `scriptHashes` allow the admin's own inline scripts, such as its import map. */
export function policy(
  config: Required<Omit<CspConfig, 'reportUri'>> & Pick<CspConfig, 'reportUri'>,
  scriptHashes: readonly string[] = [],
): string {
  const directives: string[][] = [
    ["default-src 'self'"],
    ["script-src 'self'", ...scriptHashes],
    // Vue transitions write `style` attributes.
    ["style-src 'self' 'unsafe-inline'"],
    ["font-src 'self' data:"],
    // `blob:` for the image editor canvas, `data:` for inline icons.
    [`img-src 'self' data: blob:`, ...config.imgSrc],
    [`connect-src 'self'`, ...config.connectSrc],
    [`frame-src ${config.frameSrc.join(' ') || "'none'"}`],
    ["object-src 'none'"],
    ["base-uri 'self'"],
    ["form-action 'self'"],
    // Prevents clickjacking.
    ["frame-ancestors 'none'"],
  ];
  if (config.reportUri) directives.push([`report-uri ${config.reportUri}`]);
  return directives.map((parts) => parts.join(' ')).join('; ');
}
