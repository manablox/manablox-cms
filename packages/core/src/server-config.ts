/** Server, CSP, public API and GraphQL settings. */

/**
 * A mountable surface. `media` and `uploads` are split so public instances can skip uploads.
 * `control` is in no preset; it must be named and needs `control.apiKey`.
 */
export type ServerScope = 'rpc' | 'auth' | 'uploads' | 'media' | 'graphql' | 'delivery' | 'control';

/** `public` also drops drafts, pins the space, masks errors and re-keys the rate limiter. */
export type CoreServerMode = 'management' | 'public';

/** A core mode, or one a plugin declares in `modes`. */
export type ServerMode = CoreServerMode | (string & {});

export const CORE_SERVER_MODES: readonly CoreServerMode[] = Object.freeze([
  'management',
  'public',
] as const);

export const MANAGEMENT_SCOPES: readonly ServerScope[] = Object.freeze([
  'rpc',
  'auth',
  'uploads',
  'media',
  'graphql',
] as const);

export const PUBLIC_SCOPES: readonly ServerScope[] = Object.freeze([
  'graphql',
  'media',
  'delivery',
] as const);

/** Drops duplicates, preserving order. */
export function expandScopes(scopes: readonly ServerScope[]): ServerScope[] {
  const out: ServerScope[] = [];
  for (const scope of scopes) {
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}

export interface ServerConfig {
  host?: string;
  port?: number;
  /** Public origin the delivery API is served from. */
  publicUrl?: string;
  /** Admin origin for workflow links. Defaults to the first CORS origin, then `publicUrl`. */
  adminUrl?: string;
  cors?: { origin: string[] | '*'; credentials?: boolean };
  /** Requests per minute per IP, per scope. */
  rateLimit?: { window: number; max: number } | false;
  /**
   * Proxies (addresses or CIDR ranges) whose client-IP headers are believed; `[]` believes
   * none. Unset believes every peer's headers. Defaults to `TRUSTED_PROXIES`.
   */
  trustedProxies?: string[];
  /** Which scopes this process mounts. */
  scopes?: ServerScope[];
  /** Defaults to `management`; a plugin mode needs its plugin in `plugins`. */
  mode?: ServerMode;
  /**
   * Serve the admin at `/`. `true` uses `@manablox/admin`, an object names a directory.
   * Management instances only.
   */
  admin?: boolean | { dir: string };
  /** The Content-Security-Policy the admin's own HTML is served with. */
  csp?: CspConfig;
}

/**
 * The admin's CSP. `frame-src` and `img-src` default to any origin, since spaces and asset
 * buckets can live anywhere; everything else is closed. Report-only by default.
 */
export interface CspConfig {
  /** Set false to send no policy at all. */
  enabled?: boolean;
  /** `Content-Security-Policy-Report-Only` rather than the enforcing header. Defaults to true. */
  reportOnly?: boolean;
  /** Origins the admin may frame. Defaults to any; plugins' `admin.frameOrigins` join a list. */
  frameSrc?: string[];
  /** Origins images may come from, beyond `'self' data: blob:`. Defaults to any. */
  imgSrc?: string[];
  /** Origins the admin may call, beyond its own. */
  connectSrc?: string[];
  /** Where violations are posted, if anywhere. */
  reportUri?: string;
}

/** The control API (scope `control`), for the layer that sets features and limits. */
export interface ControlApiConfig {
  /** Bearer key; the scope does not start without it. */
  apiKey?: string;
  /** A second valid key, for rotation. */
  nextApiKey?: string;
  /** Client IPs or CIDR ranges allowed to call it; any when absent. */
  allowedIps?: string[];
  /**
   * Accounts come from the control API: sign-up is closed and no account is promoted to
   * superadmin. Also on once the control API created the owner.
   */
  provisioned?: boolean;
  /** Logs every metered request at info level with its space, bytes and cache state. */
  usageLog?: boolean;
  /** Where control events are pushed; needs `webhookSecret`. */
  webhookUrl?: string;
  /** Signs pushed events (`X-Manablox-Signature`). */
  webhookSecret?: string;
  /** A host a custom domain may CNAME to instead of a TXT record, to prove ownership. */
  domainCnameTarget?: string;
}

/** `public` mode settings, declared unconditionally so both instances share one config. */
export interface PublicApiConfig {
  /** The one space this instance serves. Takes precedence over `spaceMachineName`. */
  spaceId?: string;
  /** Resolved to an id once, at boot, when `spaceId` is absent. */
  spaceMachineName?: string;
  /** Off unless explicitly enabled. */
  introspection?: boolean;
  maxDepth?: number;
  maxComplexity?: number;
  /** `s-maxage` for delivery responses, in seconds. Falls back to `cache.ttl`. */
  cacheTtl?: number;
  rateLimit?: { window: number; max: number } | false;
  /** With a manifest, only these query hashes execute; unknown ones are logged. */
  persistedOperations?: {
    manifest: Record<string, string>;
    /** When false, unknown hashes are logged and allowed. Defaults to true. */
    rejectUnknown?: boolean;
  };
}

export interface GraphQLConfig {
  path?: string;
  maxDepth?: number;
  maxComplexity?: number;
  introspection?: boolean;
  /** Only serve published content unless the request is authenticated for preview. */
  previewHeader?: string;
}

export interface ResolvedServerConfig {
  host: string;
  port: number;
  publicUrl: string;
  adminUrl: string;
  scopes: ServerScope[];
  mode: ServerMode;
  /** `false`, or where the admin comes from: the package, or a directory. */
  admin: false | { dir: string | null };
  cors?: { origin: string[] | '*'; credentials?: boolean };
  rateLimit?: { window: number; max: number } | false;
  trustedProxies?: string[];
  csp: Required<Omit<CspConfig, 'reportUri'>> & Pick<CspConfig, 'reportUri'>;
}
