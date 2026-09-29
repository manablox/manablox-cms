import type { PluginResourceEntry } from './code-resource.js';
import {
  collect,
  collectPluginResources,
  dedupeFieldTypes,
  flattenPlugins,
  mergeExtension,
} from './config-merge.js';
import { type ContentTypeInput, defineContentType } from './content-type.js';
import type { CredentialDefinition } from './credential-define.js';
import { controlApiConfigFromEnv, envTrustedProxies } from './env.js';
import { ManabloxError, ValidationCollector } from './errors.js';
import type { LoggingConfig } from './logger.node.js';
import {
  type MailConfig,
  type ResolvedMailConfig,
  resolveMail,
  validateMailTransport,
} from './mail-config.js';
import { DEFAULT_MEDIA_PRESETS, type MediaConfig, type StorageConfig } from './media-config.js';
import { type ManabloxPlugin, pluginId } from './plugin.js';
import { formatDataIssue } from './plugin-blocks.js';
import { registerPluginCatalogue } from './plugin-catalogue.js';
import { checkContributions } from './plugin-contributions.js';
import { orderPlugins } from './plugin-graph.js';
import {
  type ControlApiConfig,
  expandScopes,
  type GraphQLConfig,
  MANAGEMENT_SCOPES,
  PUBLIC_SCOPES,
  type PublicApiConfig,
  type ResolvedServerConfig,
  type ServerConfig,
  type ServerMode,
} from './server-config.js';
import { pluginServerModes, serverModeProblem } from './server-modes.js';
import type { TemplateDefinition } from './template-define.js';
import type { AnyFieldType, ContentTypeDefinition } from './types.js';

export type { MailConfig, ResolvedMailConfig } from './mail-config.js';

export interface DatabaseConfig {
  /** `postgres://…` for Postgres; `file:…`, `libsql://…` or `https://…` for SQLite and Turso. */
  url: string;
  /** Connection-pool size. */
  max?: number;
  ssl?: boolean;
  /** Turso auth token. */
  authToken?: string;
  /** Postgres only: the owner role's URL; migrations run through it and grant `url`'s role. */
  migrationUrl?: string;
}

export type DatabaseDialect = 'postgres' | 'sqlite';

/** The database a URL names, or `null` for a scheme Manablox does not support. */
export function databaseDialect(url: string): DatabaseDialect | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1]?.toLowerCase();
  if (scheme === 'postgres' || scheme === 'postgresql') return 'postgres';
  if (scheme && ['file', 'sqlite', 'libsql', 'http', 'https', 'ws', 'wss'].includes(scheme)) {
    return 'sqlite';
  }
  return null;
}

export interface AuthConfig {
  secret: string;
  baseUrl?: string;
  trustedOrigins?: string[];
  emailAndPassword?: boolean;
  sessionMaxAge?: number;
}

export interface CacheConfig {
  redisUrl?: string;
  /** Delivery API `s-maxage`, in seconds. */
  ttl?: number;
  enabled?: boolean;
  /**
   * Seconds between checks for content types another process saved, when there is no
   * Redis to announce them. `0` turns the check off. Defaults to 5.
   */
  syncInterval?: number;
}

/** Web Push via VAPID (RFC 8292); `subject` is a `mailto:` or `https:` contact URL. */
export interface PushConfig {
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  subject?: string;
}

/**
 * Egress limits for requests to user-configured URLs (control events and plugins such as
 * webhooks and AI). Strict by default: those URLs are editor-written, not reviewed code.
 */
export interface NetConfig {
  /**
   * Lets requests reach loopback, private and link-local addresses, such as the metadata
   * service. Only for a trusted, isolated install.
   */
  allowPrivateNetwork?: boolean;
  /** Bytes read from one response before it is cut off. */
  maxResponseBytes?: number;
  /** Redirects followed by one request; every hop is address-checked again. */
  maxRedirects?: number;
}

/**
 * Resources declared in code (vault slots, templates, plugin resource kinds) and when they
 * are written to the database.
 */
export interface CodeResourcesConfig {
  /** `manual` (default) waits for `manablox sync`; `boot` reconciles on start, management only. */
  apply?: 'boot' | 'manual';
  /**
   * Delete code rows whose declaration is gone, instead of disabling them. Off by default:
   * rolling deploys run two versions, and deleting a row drops its history, such as runs.
   */
  prune?: boolean;
  /** Vault slots. See `defineCredential`. */
  credentials?: CredentialDefinition[];
  /** Content templates. See `defineTemplate`. */
  templates?: TemplateDefinition[];
  /** Entries of plugin resource kinds by kind (`<plugin id>.<name>`), next to the plugins' own. */
  plugins?: Record<string, PluginResourceEntry[]>;
}

/** The same lists, flattened across the config and every plugin. */
export interface ResolvedCodeResources {
  apply: 'boot' | 'manual';
  prune: boolean;
  credentials: CredentialDefinition[];
  templates: TemplateDefinition[];
  /** Entries of plugin resource kinds by kind, config first. */
  plugins: Record<string, PluginResourceEntry[]>;
}

export interface ManabloxConfig {
  database: DatabaseConfig;
  server?: ServerConfig;
  graphql?: GraphQLConfig;
  storage?: StorageConfig;
  media?: MediaConfig;
  auth: AuthConfig;
  cache?: CacheConfig;
  mail?: MailConfig;
  push?: PushConfig;
  net?: NetConfig;
  publicApi?: PublicApiConfig;
  /** Defaults to the `CONTROL_API_*` environment variables. */
  control?: ControlApiConfig;
  fieldTypes?: AnyFieldType[];
  contentTypes?: ContentTypeInput[];
  resources?: CodeResourcesConfig;
  plugins?: ManabloxPlugin[];
  /** Shorthand for `logging.level`. */
  logLevel?: string;
  /** Level, destinations and redaction. */
  logging?: LoggingConfig;
}

export function defineConfig(config: ManabloxConfig): ManabloxConfig {
  return config;
}

function resolveAdmin(
  admin: boolean | { dir: string } | undefined,
): false | { dir: string | null } {
  if (!admin) return false;
  return { dir: admin === true ? null : admin.dir };
}

export interface ResolvedConfig {
  database: Required<Pick<DatabaseConfig, 'url'>> & DatabaseConfig;
  server: ResolvedServerConfig;
  publicApi: PublicApiConfig;
  control: ControlApiConfig;
  graphql: Required<Omit<GraphQLConfig, 'previewHeader'>> & Pick<GraphQLConfig, 'previewHeader'>;
  storage: StorageConfig;
  media: Required<Omit<MediaConfig, 'signingSecret'>> & Pick<MediaConfig, 'signingSecret'>;
  auth: AuthConfig;
  cache: Required<Omit<CacheConfig, 'redisUrl'>> & Pick<CacheConfig, 'redisUrl'>;
  mail: ResolvedMailConfig;
  push: PushConfig;
  net: Required<NetConfig>;
  fieldTypes: AnyFieldType[];
  contentTypes: ContentTypeDefinition[];
  /** Flattened from the config and every plugin, each entry carrying its `sourceRef`. */
  resources: ResolvedCodeResources;
  plugins: ManabloxPlugin[];
  logLevel: string;
  logging: LoggingConfig & { level: string };
}

/** Refuses `plugins` entries of code types that no plugin checks, or that its check fails. */
function assertPluginTypeData(
  types: readonly ContentTypeDefinition[],
  plugins: readonly ManabloxPlugin[],
): void {
  for (const type of types) {
    for (const [id, value] of Object.entries(type.plugins ?? {})) {
      const check = plugins.find((plugin) => pluginId(plugin.name) === id)?.contentTypeData;
      if (!check) {
        throw ManabloxError.badRequest('contentType.plugin.unknown', {
          name: type.name,
          plugin: id,
        });
      }
      const issues = check.validate(value, type);
      if (issues.length) {
        throw ManabloxError.badRequest('contentType.plugin.invalid', {
          name: type.name,
          plugin: id,
          issues: issues.slice(0, 20).map(formatDataIssue).join('; '),
        });
      }
    }
  }
}

/** Config plus plugins as a frozen snapshot; the input is not mutated. */
export function resolveConfig(config: ManabloxConfig): ResolvedConfig {
  validateConfig(config);

  // `logging.level` wins over `logLevel`.
  const logLevel = config.logging?.level ?? config.logLevel ?? process.env.LOG_LEVEL ?? 'info';
  // Each after the plugins it needs; see `orderPlugins`.
  const plugins = orderPlugins(flattenPlugins(config.plugins ?? []));
  registerPluginCatalogue(plugins);
  checkContributions(plugins);

  const fieldTypes = dedupeFieldTypes([
    ...(config.fieldTypes ?? []),
    ...plugins.flatMap((plugin) => plugin.fieldTypes ?? []),
  ]);
  const contentTypes = resolveContentTypes(config, plugins);
  const server = resolveServer(config, plugins);

  return Object.freeze({
    database: { max: 10, ssl: false, ...config.database },
    server,
    publicApi: config.publicApi ?? {},
    control: config.control ?? controlApiConfigFromEnv(),
    graphql: {
      path: config.graphql?.path ?? '/graphql',
      maxDepth: config.graphql?.maxDepth ?? 12,
      maxComplexity: config.graphql?.maxComplexity ?? 5000,
      introspection: config.graphql?.introspection ?? process.env.NODE_ENV !== 'production',
      ...(config.graphql?.previewHeader ? { previewHeader: config.graphql.previewHeader } : {}),
    },
    storage: resolveStorage(config.storage),
    media: {
      presets: config.media?.presets ?? DEFAULT_MEDIA_PRESETS,
      eager: config.media?.eager ?? ['thumb'],
      cachePath: config.media?.cachePath ?? './data/media-cache',
      ...(config.media?.signingSecret ? { signingSecret: config.media.signingSecret } : {}),
    },
    // Pins the cookie origin; better-auth would otherwise guess it per request.
    auth: { baseUrl: server.publicUrl, ...config.auth },
    cache: {
      enabled: config.cache?.enabled ?? true,
      ttl: config.cache?.ttl ?? 60,
      syncInterval: config.cache?.syncInterval ?? 5,
      ...(config.cache?.redisUrl ? { redisUrl: config.cache.redisUrl } : {}),
    },
    mail: resolveMail(config.mail),
    push: config.push ?? {},
    net: {
      allowPrivateNetwork: config.net?.allowPrivateNetwork ?? false,
      maxResponseBytes: config.net?.maxResponseBytes ?? 2_000_000,
      maxRedirects: config.net?.maxRedirects ?? 3,
    },
    fieldTypes,
    contentTypes,
    resources: resolveResources(config, plugins),
    plugins,
    logLevel,
    logging: { ...config.logging, level: logLevel },
  }) as ResolvedConfig;
}

/** Config first, then plugins in order; then `extend` adds fields to types declared anywhere. */
function resolveContentTypes(
  config: ManabloxConfig,
  plugins: readonly ManabloxPlugin[],
): ContentTypeDefinition[] {
  const declared = new Map<string, ContentTypeInput>();
  for (const input of config.contentTypes ?? []) {
    declared.set(input.name, input);
  }
  for (const plugin of plugins) {
    for (const input of plugin.contentTypes ?? []) {
      if (declared.has(input.name)) {
        throw ManabloxError.conflict('contentType.name.duplicate', {
          name: input.name,
          plugin: plugin.name,
        });
      }
      declared.set(input.name, input);
    }
  }
  for (const plugin of plugins) {
    for (const extension of plugin.extend ?? []) {
      const target = declared.get(extension.name);
      if (!target) {
        throw ManabloxError.notFound('plugin.extend.contentType.notFound', {
          plugin: plugin.name,
          contentType: extension.name,
        });
      }
      declared.set(extension.name, mergeExtension(target, extension));
    }
  }

  const contentTypes = [...declared.values()].map((input) => defineContentType(input));
  assertPluginTypeData(contentTypes, plugins);
  return contentTypes;
}

function resolveServer(config: ManabloxConfig, plugins: readonly ManabloxPlugin[]) {
  const mode: ServerMode = config.server?.mode ?? 'management';
  // An explicit list wins; otherwise the mode picks its preset.
  const pluginMode = pluginServerModes(plugins).get(mode)?.mode;
  const scopes = expandScopes(
    config.server?.scopes ?? [
      ...(pluginMode?.scopes ?? (mode === 'public' ? PUBLIC_SCOPES : MANAGEMENT_SCOPES)),
    ],
  );

  const publicUrl = config.server?.publicUrl ?? `http://localhost:${config.server?.port ?? 3000}`;
  const corsOrigin = config.server?.cors?.origin;
  const adminUrl =
    config.server?.adminUrl ?? (Array.isArray(corsOrigin) ? corsOrigin[0] : undefined) ?? publicUrl;

  return {
    host: config.server?.host ?? '0.0.0.0',
    port: config.server?.port ?? 3000,
    publicUrl,
    adminUrl,
    scopes,
    mode,
    admin: resolveAdmin(config.server?.admin),
    csp: {
      enabled: config.server?.csp?.enabled ?? true,
      reportOnly: config.server?.csp?.reportOnly ?? true,
      frameSrc: frameSources(
        config.server?.csp?.frameSrc,
        plugins.flatMap((plugin) => plugin.admin?.frameOrigins ?? []),
      ),
      imgSrc: config.server?.csp?.imgSrc ?? ['*'],
      connectSrc: config.server?.csp?.connectSrc ?? [],
      ...(config.server?.csp?.reportUri ? { reportUri: config.server.csp.reportUri } : {}),
    },
    // A wildcard origin is never credentialed; browsers would refuse it.
    cors: config.server?.cors ?? { origin: '*' as const, credentials: false },
    rateLimit: config.server?.rateLimit ?? { window: 60_000, max: 600 },
    ...trustedProxiesOf(config.server?.trustedProxies),
  };
}

function resolveResources(
  config: ManabloxConfig,
  plugins: ManabloxPlugin[],
): ResolvedCodeResources {
  return {
    apply: config.resources?.apply ?? 'manual',
    prune: config.resources?.prune ?? false,
    credentials: collect(
      'credential',
      config.resources?.credentials,
      plugins,
      (p) => p.credentials,
    ),
    templates: collect('template', config.resources?.templates, plugins, (p) => p.templates),
    plugins: collectPluginResources(config.resources?.plugins, plugins),
  };
}

const KNOWN_SCOPES: readonly string[] = [
  'rpc',
  'auth',
  'uploads',
  'media',
  'graphql',
  'delivery',
  'control',
];

/** Any origin by default; a restricted list also gets the plugins' origins. */
function frameSources(configured: string[] | undefined, extra: readonly string[]): string[] {
  if (!configured) return ['*'];
  if (configured.includes('*')) return configured;
  const out = [...configured];
  for (const url of extra) {
    if (!URL.canParse(url)) continue;
    const origin = new URL(url).origin;
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Checks what types cannot (env strings), reporting every problem with its config path. */
/** The configured proxies, else `TRUSTED_PROXIES`; absent when neither is set. */
function trustedProxiesOf(configured: string[] | undefined): { trustedProxies?: string[] } {
  const trustedProxies = configured ?? envTrustedProxies();
  return trustedProxies ? { trustedProxies } : {};
}

export function validateConfig(config: ManabloxConfig): void {
  const collector = new ValidationCollector();

  for (const [index, scope] of (config.server?.scopes ?? []).entries()) {
    if (!KNOWN_SCOPES.includes(scope)) {
      collector.add('config.scope.unknown', ['server', 'scopes', index], {
        scope,
        known: KNOWN_SCOPES.join(', '),
      });
    }
  }

  const control = config.control ?? controlApiConfigFromEnv();
  if (config.server?.scopes?.includes('control') && !control.apiKey) {
    collector.add('config.control.keyMissing', ['control', 'apiKey']);
  }
  if (control.webhookUrl !== undefined) {
    const url = URL.canParse(control.webhookUrl) ? new URL(control.webhookUrl) : null;
    if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
      collector.add('config.control.webhookUrlInvalid', ['control', 'webhookUrl']);
    }
    if (!control.webhookSecret) {
      collector.add('config.control.webhookSecretMissing', ['control', 'webhookSecret']);
    }
  }

  const modeProblem =
    config.server?.mode !== undefined
      ? serverModeProblem(config.server.mode, flattenPlugins(config.plugins ?? []))
      : null;
  if (modeProblem) {
    collector.add(modeProblem.key, ['server', 'mode'], {
      mode: modeProblem.mode,
      known: modeProblem.known.join(', '),
    });
  }

  const port = config.server?.port;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
    collector.add('config.port.invalid', ['server', 'port'], { port });
  }

  const syncInterval = config.cache?.syncInterval;
  if (syncInterval !== undefined && !(Number.isFinite(syncInterval) && syncInterval >= 0)) {
    collector.add('config.cache.syncIntervalInvalid', ['cache', 'syncInterval'], { syncInterval });
  }

  validateMailTransport(config.mail?.transport, collector);

  // Browsers refuse credentialed wildcard CORS; fail at boot instead of silently.
  const cors = config.server?.cors;
  if (cors?.origin === '*' && cors.credentials === true) {
    collector.add('config.cors.credentialedWildcard', ['server', 'cors']);
  }

  if (!config.database?.url) collector.add('config.database.urlMissing', ['database', 'url']);
  else if (!databaseDialect(config.database.url)) {
    collector.add('config.database.urlUnsupported', ['database', 'url']);
  }
  if (!config.auth?.secret) collector.add('config.auth.secretMissing', ['auth', 'secret']);

  collector.throwIfAny('config.invalid');
}

/** The local driver's directory by default. */
function resolveStorage(storage: StorageConfig | undefined): StorageConfig {
  return storage ?? { driver: 'local', local: { path: './data/uploads' } };
}
