/**
 * `@manablox/plugin-webhooks/sdk`: incoming and outgoing webhooks, modelled as one endpoint
 * shape. Browser-safe.
 */

import {
  type CredentialKind,
  type ResourceSource,
  SIGNATURE_HEADER,
  type SignatureAlgorithm,
  type SignatureFormat,
} from '@manablox/core';

export const WEBHOOK_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type WebhookDirection = (typeof WEBHOOK_DIRECTIONS)[number];

export const WEBHOOK_DIRECTION_LABELS: Record<
  WebhookDirection,
  { label: string; description: string }
> = {
  incoming: {
    label: 'Incoming',
    description: 'A URL another system calls. Whatever listens on it, such as workflows, runs.',
  },
  outgoing: {
    label: 'Outgoing',
    description: 'A URL this space calls when content changes.',
  },
};

// --- how a call proves who it is ------------------------------------------------------

/** Auth for either direction, each mode backed by a vault credential. */
export const WEBHOOK_AUTH_MODES = ['none', 'hmac', 'token', 'basic', 'bearer', 'oauth2'] as const;
export type WebhookAuthMode = (typeof WEBHOOK_AUTH_MODES)[number];

/** The credential kind each mode needs, or null when it needs none. */
export const WEBHOOK_AUTH_CREDENTIAL_KIND: Record<WebhookAuthMode, CredentialKind | null> = {
  none: null,
  hmac: 'signing',
  token: 'apiKey',
  basic: 'basic',
  bearer: 'bearer',
  oauth2: 'oauth2',
};

export const WEBHOOK_AUTH_MODE_LABELS: Record<
  WebhookAuthMode,
  { label: string; description: string }
> = {
  none: {
    label: 'Nothing',
    description: 'Anyone who knows the URL may call it. Only sensible behind a private network.',
  },
  hmac: {
    label: 'Signature',
    description: 'The body is signed with a shared secret, the way GitHub and Stripe sign theirs.',
  },
  token: {
    label: 'Token in a header',
    description: 'A fixed key in a header you name.',
  },
  basic: {
    label: 'Username and password',
    description: 'HTTP basic authentication.',
  },
  bearer: {
    label: 'Bearer token',
    description: 'Sent as `Authorization: Bearer <token>`.',
  },
  oauth2: {
    label: 'OAuth 2',
    description: 'A refresh token exchanged for an access token per call. Outgoing only.',
  },
};

/** Modes per direction; incoming calls cannot be checked against OAuth. */
export const WEBHOOK_AUTH_MODES_BY_DIRECTION: Record<WebhookDirection, WebhookAuthMode[]> = {
  incoming: ['none', 'hmac', 'token', 'basic', 'bearer'],
  outgoing: ['none', 'hmac', 'token', 'basic', 'bearer', 'oauth2'],
};

export const WEBHOOK_SIGNATURE_FORMAT_LABELS: Record<SignatureFormat, string> = {
  prefixed: 'sha256=<hex digest>',
  hex: 'The hex digest alone',
  base64: 'The base64 digest alone',
};

/** How a call proves who it is. */
export interface WebhookAuth {
  mode: WebhookAuthMode;
  /** A credential of this space. Null only when the mode is `none`. */
  credentialId: string | null;
  /** Where the signature is read from / written to. Only meaningful for `hmac`. */
  signatureHeader: string;
  algorithm: SignatureAlgorithm;
  format: SignatureFormat;
}

export const defaultWebhookAuth = (): WebhookAuth => ({
  mode: 'none',
  credentialId: null,
  signatureHeader: SIGNATURE_HEADER,
  algorithm: 'sha256',
  format: 'prefixed',
});

// --- the endpoints --------------------------------------------------------------------

/** The HTTP methods an incoming endpoint may accept. */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** A webhook outside the vault: the credential by id, never by value. */
export interface WebhookView {
  id: string;
  spaceId: string;
  direction: WebhookDirection;
  name: string;
  /** The last segment of an incoming URL, and how an export names either kind. */
  slug: string;
  description: string | null;
  enabled: boolean;
  /** Outgoing: where the call goes. Empty on an incoming one. */
  url: string;
  /** Outgoing: the content events sent; empty means all. Unused on incoming. */
  events: string[];
  /** Outgoing: extra headers, on top of the auth ones. */
  headers: Array<{ name: string; value: string }>;
  /** Incoming: the methods accepted. Empty on an outgoing one. */
  methods: WebhookMethod[];
  auth: WebhookAuth;
  /** Incoming: the full URL to call. Computed, not stored. */
  endpoint: string | null;
  /** Incoming: how many enabled listeners it starts, such as workflows. */
  listeners: number;
  /** `code` when config or a plugin declares it; read-only in the admin. */
  source: ResourceSource;
  /** Which plugin declared it, or `config`. */
  sourceRef: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One logged call, sent or received. */
export interface WebhookDeliveryView {
  id: string;
  webhookId: string;
  direction: WebhookDirection;
  event: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  /** The HTTP status: what the far end answered, or what this instance answered. */
  status: number | null;
  error: string | null;
  attempt: number;
  ms: number | null;
  /** Incoming: the runs the call started, e.g. of workflows. */
  runIds: string[];
  createdAt: string;
}

/** The header an outgoing call names its event in, and an incoming log reads back. */
export const WEBHOOK_EVENT_HEADER = 'x-manablox-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-manablox-delivery';

/** Secret-bearing headers kept out of delivery logs. */
export const WEBHOOK_REDACTED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

/** The stored shape of an incoming call's body, whatever content type it arrived as. */
export interface WebhookPayload {
  /** The parsed body - an object when it was JSON, `{ raw: '…' }` when it was not. */
  body: unknown;
  /** The query string, as a flat map. */
  query: Record<string, string>;
  method: string;
}
