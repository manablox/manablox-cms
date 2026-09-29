import type { InvitationGrant } from '@manablox/db';

export const SSO_PROTOCOLS = ['oidc', 'saml'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/** Scopes asked for when a provider names none. */
export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];

export interface SsoOidcInput {
  issuer: string;
  clientId: string;
  /** Kept as stored when omitted on an update. */
  clientSecret?: string | undefined;
  /** `<issuer>/.well-known/openid-configuration` when omitted. */
  discoveryEndpoint?: string | undefined;
  scopes?: string[] | undefined;
}

export interface SsoSamlInput {
  /** The IdP's sign-in URL. */
  entryPoint: string;
  /** The IdP's signing certificate, PEM. */
  certificate: string;
  idpEntityId: string;
  /** The metadata URL when omitted. */
  spEntityId?: string | undefined;
  /** Attribute holding the address; `email` or the NameID by default. */
  emailAttribute?: string | undefined;
  /** Attribute holding the display name. */
  nameAttribute?: string | undefined;
  /** Signs AuthnRequests with the SP key. */
  signRequests?: boolean | undefined;
  /** Refuses assertions that are not encrypted to the SP key. */
  encryptAssertions?: boolean | undefined;
  /** Accepts IdP-initiated (unsolicited) responses. */
  idpInitiated?: boolean | undefined;
  /** Admin path after an IdP-initiated sign-in; `/` when omitted. */
  landingPath?: string | undefined;
}

export interface SsoSettingsInput {
  name: string;
  domains: string[];
  oidc?: SsoOidcInput | undefined;
  saml?: SsoSamlInput | undefined;
  requireSso?: boolean | undefined;
  showOnSignIn?: boolean | undefined;
  createAccounts?: boolean | undefined;
  defaultGrants?: InvitationGrant[] | undefined;
}

export interface SsoProviderInput extends SsoSettingsInput {
  /** The slug in its URLs; fixed once created. */
  providerId: string;
}

/** Where the IdP sends people back, and what it needs to know about Manablox. */
export interface SsoProviderUrls {
  /** OIDC redirect URI. */
  callback: string | null;
  /** SAML assertion consumer service. */
  acs: string | null;
  /** SAML service provider metadata. */
  metadata: string | null;
  spEntityId: string | null;
}

export interface SsoProviderView {
  id: string;
  providerId: string;
  name: string;
  protocol: SsoProtocol;
  domains: string[];
  oidc: {
    issuer: string;
    clientId: string;
    /** The secret's last characters; never the secret. */
    clientSecretHint: string | null;
    discoveryEndpoint: string;
    scopes: string[];
  } | null;
  saml: {
    entryPoint: string;
    certificate: string;
    certificateExpiresAt: Date | null;
    idpEntityId: string;
    spEntityId: string;
    emailAttribute: string | null;
    nameAttribute: string | null;
    signRequests: boolean;
    encryptAssertions: boolean;
    idpInitiated: boolean;
    landingPath: string;
    /** The SP signing and encryption certificate; `null` until the provider is saved again. */
    spCertificate: string | null;
    spCertificateExpiresAt: Date | null;
  } | null;
  requireSso: boolean;
  showOnSignIn: boolean;
  createAccounts: boolean;
  defaultGrants: Array<InvitationGrant & { spaceName: string | null }>;
  urls: SsoProviderUrls;
  createdAt: Date;
  updatedAt: Date;
}

export interface SsoProviderList {
  providers: SsoProviderView[];
  /** better-auth's base URL, for the URLs of a provider not saved yet. */
  authBaseUrl: string;
}

export type SsoTestResult =
  | {
      ok: true;
      protocol: 'oidc';
      authorizationEndpoint: string;
      tokenEndpoint: string;
      userInfoEndpoint: string | null;
    }
  | {
      ok: true;
      protocol: 'saml';
      subject: string;
      expiresAt: Date;
      fingerprint: string;
    }
  | { ok: false; message: string };

/** A provider as the sign-in page sees it. */
export interface SsoSignInProvider {
  providerId: string;
  name: string;
}
