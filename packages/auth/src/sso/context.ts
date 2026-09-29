import { type ErrorDetail, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { SsoProtocol, SsoProviderUrls } from './types.js';

/** What `SsoService` needs from the auth instance. */
export interface SsoAuthContext {
  baseURL: string;
  isTrustedOrigin(url: string): boolean;
}

/** What the parts of `SsoService` share. */
export interface SsoContext {
  manablox: Manablox;
  repos: Repositories;
  /** Encrypts client secrets and SP keys at rest. */
  secret: string;
  /** better-auth's context; throws until `SsoService.bind` ran. */
  auth(): Promise<SsoAuthContext>;
}

export const invalid = (details: ErrorDetail[]) =>
  ManabloxError.validation(details, 'sso.validation.failed');

/** `path` below the admin URL. */
export function adminUrl(ctx: SsoContext, path: string): string {
  return `${ctx.manablox.config.server.adminUrl.replace(/\/$/, '')}${path}`;
}

export async function providerUrls(
  ctx: SsoContext,
  providerId: string,
  protocol: SsoProtocol,
): Promise<SsoProviderUrls> {
  const base = await baseUrl(ctx);
  if (protocol === 'oidc') {
    return {
      callback: `${base}/sso/callback/${providerId}`,
      acs: null,
      metadata: null,
      spEntityId: null,
    };
  }
  return {
    callback: null,
    acs: `${base}/sso/saml2/sp/acs/${providerId}`,
    metadata: `${base}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
    spEntityId: null,
  };
}

export async function baseUrl(ctx: SsoContext): Promise<string> {
  return (await ctx.auth()).baseURL.replace(/\/$/, '');
}
