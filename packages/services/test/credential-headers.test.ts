import type { CredentialSecret } from '@manablox/core';
import { describe, expect, it, vi } from 'vitest';
import { credentialHeaders, forgetAccessToken } from '../src/credentials/index.js';

const secret = (
  kind: CredentialSecret['kind'],
  data: Record<string, string>,
): CredentialSecret => ({
  id: `c-${kind}`,
  name: kind,
  slug: kind,
  kind,
  provider: '',
  data,
});

const noFetch = (() => {
  throw new Error('no fetch expected');
}) as unknown as typeof fetch;

describe('credentialHeaders', () => {
  it('sends an API key in its header, X-Api-Key when none is named', async () => {
    expect(await credentialHeaders(secret('apiKey', { key: 'k' }), noFetch)).toEqual({
      'x-api-key': 'k',
    });
    expect(
      await credentialHeaders(
        secret('apiKey', { header: 'Authorization', key: 'k', prefix: 'Token' }),
        noFetch,
      ),
    ).toEqual({ authorization: 'Token k' });
  });

  it('sends bearer and basic credentials as authorization', async () => {
    expect(await credentialHeaders(secret('bearer', { token: 't' }), noFetch)).toEqual({
      authorization: 'Bearer t',
    });
    expect(
      await credentialHeaders(secret('basic', { username: 'u', password: 'p' }), noFetch),
    ).toEqual({ authorization: `Basic ${Buffer.from('u:p').toString('base64')}` });
  });

  it('exchanges an OAuth 2 refresh token once and sends the access token', async () => {
    const oauth = secret('oauth2', {
      tokenUrl: 'https://auth.example/token',
      clientId: 'id',
      refreshToken: 'r',
    });
    forgetAccessToken(oauth.id);
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'a', expires_in: 60 }));
    const http = fetchImpl as unknown as typeof fetch;
    expect(await credentialHeaders(oauth, http)).toEqual({ authorization: 'Bearer a' });
    expect(await credentialHeaders(oauth, http)).toEqual({ authorization: 'Bearer a' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives no headers for kinds that are not headers', async () => {
    expect(await credentialHeaders(secret('signing', { secret: 's' }), noFetch)).toEqual({});
  });
});
