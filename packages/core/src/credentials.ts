/** Credential kinds, the fields each takes, and the vault-free view of a credential. */

import type { ResourceSource } from './code-resource.js';

export const CREDENTIAL_KINDS = [
  'apiKey',
  'bearer',
  'basic',
  'oauth2',
  'smtp',
  'signing',
  'custom',
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** The header an API key goes in when its credential names none. */
export const API_KEY_HEADER = 'X-Api-Key';

/**
 * The header an API key credential is sent in, and its value: the key, after the prefix and
 * a space when there is one. Workflow requests and webhooks, both directions, read it here.
 */
export function apiKeyHeader(data: Record<string, string | undefined>): {
  name: string;
  value: string;
} {
  const prefix = data.prefix?.trim();
  const key = data.key ?? '';
  return { name: data.header?.trim() || API_KEY_HEADER, value: prefix ? `${prefix} ${key}` : key };
}

/** One field of a credential of this kind, and whether it is secret. */
export interface CredentialFieldSpec {
  name: string;
  label: string;
  hint?: string;
  /** Secret fields are write-only: stored encrypted, never sent back to the browser. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

export const CREDENTIAL_KIND_SPECS: Record<
  CredentialKind,
  { label: string; description: string; fields: CredentialFieldSpec[] }
> = {
  apiKey: {
    label: 'API key',
    description: 'A key sent in a header you name.',
    fields: [
      {
        name: 'header',
        label: 'Header',
        secret: false,
        required: true,
        placeholder: API_KEY_HEADER,
        hint: 'The header the service expects the key in.',
      },
      { name: 'key', label: 'Key', secret: true, required: true },
      {
        name: 'prefix',
        label: 'Value prefix',
        secret: false,
        required: false,
        hint: 'Put before the key, with a space. Leave empty for none.',
      },
    ],
  },
  bearer: {
    label: 'Bearer token',
    description: 'Sent as `Authorization: Bearer <token>`.',
    fields: [{ name: 'token', label: 'Token', secret: true, required: true }],
  },
  basic: {
    label: 'Username and password',
    description: 'HTTP basic authentication.',
    fields: [
      { name: 'username', label: 'Username', secret: false, required: true },
      { name: 'password', label: 'Password', secret: true, required: true },
    ],
  },
  oauth2: {
    label: 'OAuth 2 refresh token',
    description: 'A long-lived refresh token, exchanged for an access token per run.',
    fields: [
      { name: 'tokenUrl', label: 'Token endpoint', secret: false, required: true },
      { name: 'clientId', label: 'Client id', secret: false, required: true },
      { name: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { name: 'refreshToken', label: 'Refresh token', secret: true, required: true },
      { name: 'scope', label: 'Scope', secret: false, required: false },
    ],
  },
  smtp: {
    label: 'Mail account',
    description: 'An SMTP account to send through.',
    fields: [
      {
        name: 'url',
        label: 'SMTP URL',
        secret: true,
        required: true,
        placeholder: 'smtps://user:pass@smtp.example.com:465',
        hint: 'The whole connection string, password included.',
      },
      { name: 'from', label: 'From address', secret: false, required: true },
    ],
  },
  signing: {
    label: 'Signing secret',
    description: 'A shared secret an HMAC signature is computed with, in either direction.',
    fields: [
      {
        name: 'secret',
        label: 'Secret',
        secret: true,
        required: true,
        hint: 'The same string both ends hold. Long and random.',
      },
    ],
  },
  custom: {
    label: 'Free-form',
    description: 'Named values a plugin action reads for itself.',
    fields: [],
  },
};

/** A credential as everything outside the vault sees it: no secret material. */
export interface CredentialView {
  id: string;
  name: string;
  slug: string;
  kind: CredentialKind;
  provider: string;
  /** The public (non-secret) fields, in clear. */
  data: Record<string, string>;
  /** The last four characters of the first secret. */
  hint: string | null;
  /** `code` when config or a plugin declares the slot; its secret stays fillable. */
  source: ResourceSource;
  sourceRef: string | null;
  updatedAt: string;
}

/** The decrypted credential an action asked for. */
export interface CredentialSecret {
  id: string;
  name: string;
  slug: string;
  kind: CredentialKind;
  provider: string;
  /** Field name -> value, secrets included; redacted from the run log. */
  data: Record<string, string>;
}
