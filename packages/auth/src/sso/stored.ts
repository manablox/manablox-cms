import { X509Certificate } from 'node:crypto';

/** Stored OIDC config, as better-auth's `sso` plugin reads it. */
export interface StoredOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  discoveryEndpoint: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  userInfoEndpoint?: string | undefined;
  tokenEndpointAuthentication: 'client_secret_basic' | 'client_secret_post';
  pkce: boolean;
  scopes: string[];
}

/** Stored SAML config, as better-auth's `sso` plugin reads it, plus Manablox's own keys. */
export interface StoredSaml {
  issuer: string;
  entryPoint: string;
  cert: string;
  idpMetadata: { entityID: string; cert: string; isAssertionEncrypted?: boolean | undefined };
  wantAssertionsSigned: boolean;
  authnRequestsSigned?: boolean | undefined;
  /** `privateKey` is encrypted; the adapter decrypts it and adds `encPrivateKey`. */
  spMetadata?: { metadata: string; privateKey: string; encPrivateKey?: string } | undefined;
  spCertificate?: string | undefined;
  idpInitiated?: boolean | undefined;
  landingPath?: string | undefined;
  mapping?: { email?: string; name?: string } | undefined;
}

export function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** `-----BEGIN CERTIFICATE-----` added when only the base64 body was pasted. */
export function pemOf(certificate: string): string {
  const trimmed = certificate.trim();
  if (trimmed.includes('-----BEGIN')) return `${trimmed}\n`;
  const body = trimmed.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN CERTIFICATE-----\n${body.trim()}\n-----END CERTIFICATE-----\n`;
}

export function certificateOf(certificate: string): X509Certificate | null {
  try {
    return new X509Certificate(pemOf(certificate));
  } catch {
    return null;
  }
}

export function httpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function expiryOf(certificate: string): Date | null {
  const parsed = certificateOf(certificate);
  return parsed ? new Date(parsed.validTo) : null;
}
