import type { CredentialSecret } from '@manablox/core';
import { ManabloxError } from '@manablox/core';

/** Exchanges a refresh token for an access token, cached per credential for the process. */
interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/** For tests and freshly edited credentials. */
export function forgetAccessToken(credentialId: string): void {
  cache.delete(credentialId);
}

export async function accessTokenFor(
  credential: CredentialSecret,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
): Promise<string> {
  const cached = cache.get(credential.id);
  if (cached && cached.expiresAt > now() + 30_000) return cached.token;

  const { tokenUrl, clientId, clientSecret, refreshToken, scope } = credential.data;
  if (!tokenUrl || !clientId || !refreshToken) {
    throw ManabloxError.badRequest('credential.oauth.exchangeFailed', { id: credential.id });
  }

  const fail = async (response: Response | null): Promise<never> => {
    throw ManabloxError.badRequest('credential.oauth.exchangeFailed', {
      id: credential.id,
      ...(response ? { status: response.status } : {}),
    });
  };
  const { token, expiresIn } = await requestAccessToken(
    fetchImpl,
    tokenUrl,
    {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      ...(scope ? { scope } : {}),
    },
    fail,
  );
  cache.set(credential.id, { token, expiresAt: now() + expiresIn * 1000 });
  return token;
}

/** A token endpoint's answer; `expiresIn` in seconds. */
export interface AccessToken {
  token: string;
  expiresIn: number;
}

/**
 * POSTs a form-encoded OAuth grant to a token endpoint. `fail` gets the refused response, or
 * `null` when the answer carries no token, and throws the caller's error.
 */
export async function requestAccessToken(
  fetchImpl: typeof fetch,
  tokenUrl: string,
  params: Record<string, string>,
  fail: (response: Response | null) => Promise<never>,
): Promise<AccessToken> {
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) return fail(response);
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) return fail(null);
  return { token: payload.access_token, expiresIn: payload.expires_in ?? 3600 };
}
