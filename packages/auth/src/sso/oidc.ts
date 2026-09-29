import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import { DiscoveryError, discoverOIDCConfig } from '@better-auth/sso';
import { ManabloxError } from '@manablox/core';
import { assertAllowedUrl, encryptSecret } from '@manablox/core/node';
import type { SsoProviderRow } from '@manablox/db';
import { invalid, type SsoContext } from './context.js';
import { httpUrl, parseJson, type StoredOidc } from './stored.js';
import { DEFAULT_OIDC_SCOPES, type SsoOidcInput } from './types.js';

const DISCOVERY_TIMEOUT_MS = 10_000;

export async function oidcConfig(
  ctx: SsoContext,
  input: SsoOidcInput,
  before: SsoProviderRow | null,
): Promise<StoredOidc> {
  const issuer = httpUrl(input.issuer)?.replace(/\/$/, '');
  if (!issuer) throw invalid([{ key: 'sso.url.invalid', path: ['oidc', 'issuer'] }]);
  const discoveryEndpoint = input.discoveryEndpoint?.trim()
    ? httpUrl(input.discoveryEndpoint)
    : `${issuer}/.well-known/openid-configuration`;
  if (!discoveryEndpoint) {
    throw invalid([{ key: 'sso.url.invalid', path: ['oidc', 'discoveryEndpoint'] }]);
  }
  const clientId = input.clientId.trim();
  if (!clientId) throw invalid([{ key: 'sso.clientId.required', path: ['oidc', 'clientId'] }]);
  const previous = parseJson<Partial<StoredOidc>>(before?.oidcConfig ?? null);
  const clientSecret = input.clientSecret?.trim()
    ? encryptSecret(input.clientSecret.trim(), ctx.secret)
    : previous?.clientSecret;
  if (!clientSecret) {
    throw invalid([{ key: 'sso.clientSecret.required', path: ['oidc', 'clientSecret'] }]);
  }
  let found: Awaited<ReturnType<typeof discover>>;
  try {
    found = await discover(ctx, issuer, discoveryEndpoint);
  } catch (error) {
    throw invalid([
      {
        key: 'sso.discovery.failed',
        path: ['oidc', 'issuer'],
        params: { reason: discoveryMessage(error) },
      },
    ]);
  }
  const scopes = (input.scopes ?? []).map((scope) => scope.trim()).filter(Boolean);
  return {
    issuer,
    clientId,
    clientSecret,
    discoveryEndpoint,
    authorizationEndpoint: found.authorizationEndpoint,
    tokenEndpoint: found.tokenEndpoint,
    jwksEndpoint: found.jwksEndpoint,
    ...(found.userInfoEndpoint ? { userInfoEndpoint: found.userInfoEndpoint } : {}),
    tokenEndpointAuthentication: found.tokenEndpointAuthentication,
    pkce: true,
    scopes: scopes.length > 0 ? [...new Set(scopes)] : DEFAULT_OIDC_SCOPES,
  };
}

/**
 * The IdP's endpoints from its discovery document. Hosts must be public, or listed in
 * `auth.trustedOrigins` for an internal IdP.
 */
export async function discover(
  ctx: SsoContext,
  issuer: string,
  discoveryEndpoint?: string | undefined,
) {
  const context = await ctx.auth();
  const reachable = (url: string): boolean => {
    if (context.isTrustedOrigin(url)) return true;
    try {
      return isPublicRoutableHost(new URL(url).hostname);
    } catch {
      return false;
    }
  };
  const url = discoveryEndpoint || `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  if (!context.isTrustedOrigin(url)) {
    // Only public hosts; an internal provider's origin goes in `auth.trustedOrigins`.
    await assertAllowedUrl(new URL(url), { allowPrivateNetwork: false }).catch(() => {
      throw new DiscoveryError(
        'discovery_private_host',
        `${new URL(url).hostname} is not a public host; add its origin to auth.trustedOrigins for an internal provider.`,
      );
    });
  }
  const found = await discoverOIDCConfig({
    issuer,
    discoveryEndpoint: url,
    isTrustedOrigin: reachable,
    timeout: DISCOVERY_TIMEOUT_MS,
  });
  const auth = found.tokenEndpointAuthentication;
  if (auth !== 'client_secret_basic' && auth !== 'client_secret_post') {
    throw new DiscoveryError(
      'unsupported_token_auth_method',
      'The provider only accepts client authentication methods Manablox does not support.',
    );
  }
  return {
    authorizationEndpoint: found.authorizationEndpoint as string,
    tokenEndpoint: found.tokenEndpoint as string,
    jwksEndpoint: found.jwksEndpoint as string,
    userInfoEndpoint: found.userInfoEndpoint,
    tokenEndpointAuthentication: auth,
  };
}

export function discoveryMessage(error: unknown): string {
  if (error instanceof DiscoveryError) return error.message;
  if (error instanceof ManabloxError) return error.key;
  return 'The discovery document could not be fetched.';
}
