import { apiKeyHeader, type CredentialSecret } from '@manablox/core';
import { accessTokenFor } from './oauth.js';

/**
 * The request headers that carry a credential, by lower-cased name: an API key as its header
 * (`X-Api-Key` by default), bearer and OAuth 2 tokens and basic auth as `authorization`.
 * Other kinds (SMTP, custom, HMAC secrets) are not headers and give none.
 */
export async function credentialHeaders(
  credential: CredentialSecret,
  fetchImpl: typeof fetch,
): Promise<Record<string, string>> {
  const data = credential.data;
  switch (credential.kind) {
    case 'apiKey': {
      const { name, value } = apiKeyHeader(data);
      return { [name.toLowerCase()]: value };
    }
    case 'bearer':
      return { authorization: `Bearer ${data.token ?? ''}` };
    case 'basic': {
      const pair = `${data.username ?? ''}:${data.password ?? ''}`;
      return { authorization: `Basic ${Buffer.from(pair).toString('base64')}` };
    }
    case 'oauth2':
      return { authorization: `Bearer ${await accessTokenFor(credential, fetchImpl)}` };
    default:
      return {};
  }
}
