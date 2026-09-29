import type { CacheConfig, DatabaseConfig, MailConfig } from './config.js';
import type { LogAdapterConfig, LoggingConfig, LogLevel } from './logger.node.js';
import { MAIL_DRIVERS, type MailDriver, type MailTransportConfig } from './mail.js';
import type { MediaConfig, StorageConfig } from './media-config.js';
import type { ControlApiConfig, ServerMode, ServerScope } from './server-config.js';

/** Typed environment readers for `manablox.config.ts`. */
export type Env = Record<string, string | undefined>;

export function requireEnv(name: string, env: Env = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function envString(name: string, fallback: string, env: Env = process.env): string {
  return env[name] || fallback;
}

export function envOptional(name: string, env: Env = process.env): string | undefined {
  return env[name] || undefined;
}

export function envNumber(name: string, fallback: number, env: Env = process.env): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} is not a number: ${raw}`);
  return value;
}

export function envOptionalNumber(name: string, env: Env = process.env): number | undefined {
  return env[name] ? envNumber(name, 0, env) : undefined;
}

/** `true`/`false`; anything else is the fallback. */
export function envBoolean(name: string, fallback: boolean, env: Env = process.env): boolean {
  const raw = env[name];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

/** A comma-separated list, trimmed, with empty entries dropped. */
export function envList(name: string, fallback: string[], env: Env = process.env): string[] {
  const raw = env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** `SCOPES=graphql,media`; validated for real by `resolveConfig`. */
export function envScopes(env: Env = process.env): ServerScope[] | undefined {
  const list = envList('SCOPES', [], env);
  return list.length ? (list as ServerScope[]) : undefined;
}

export function envServerMode(env: Env = process.env): ServerMode | undefined {
  return envOptional('SERVER_MODE', env) as ServerMode | undefined;
}

/** `TRUSTED_PROXIES`: addresses or CIDR ranges, `none` for none; `undefined` when unset. */
export function envTrustedProxies(env: Env = process.env): string[] | undefined {
  const raw = envOptional('TRUSTED_PROXIES', env);
  if (raw === undefined) return undefined;
  return raw.trim() === 'none' ? [] : envList('TRUSTED_PROXIES', [], env);
}

/**
 * `CONTROL_API_KEY`, `CONTROL_API_KEY_NEXT`, `CONTROL_API_ALLOWED_IPS` (comma-separated),
 * `CONTROL_PROVISIONED`, `USAGE_REQUEST_LOG`, `CONTROL_WEBHOOK_URL`, `CONTROL_WEBHOOK_SECRET`
 * and `DOMAIN_CNAME_TARGET`.
 */
export function controlApiConfigFromEnv(env: Env = process.env): ControlApiConfig {
  const apiKey = envOptional('CONTROL_API_KEY', env);
  const nextApiKey = envOptional('CONTROL_API_KEY_NEXT', env);
  const allowedIps = envList('CONTROL_API_ALLOWED_IPS', [], env);
  const webhookUrl = envOptional('CONTROL_WEBHOOK_URL', env);
  const webhookSecret = envOptional('CONTROL_WEBHOOK_SECRET', env);
  const domainCnameTarget = envOptional('DOMAIN_CNAME_TARGET', env);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(nextApiKey ? { nextApiKey } : {}),
    ...(allowedIps.length ? { allowedIps } : {}),
    ...(envBoolean('CONTROL_PROVISIONED', false, env) ? { provisioned: true } : {}),
    ...(envBoolean('USAGE_REQUEST_LOG', false, env) ? { usageLog: true } : {}),
    ...(webhookUrl ? { webhookUrl } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
    ...(domainCnameTarget ? { domainCnameTarget } : {}),
  };
}

/**
 * `DATABASE_URL` (after `urlVar` when given) and pool size; `DATABASE_AUTH_TOKEN` for a remote
 * libSQL or Turso database, `DATABASE_SSL` and `MIGRATION_DATABASE_URL` for Postgres.
 */
export function databaseConfigFromEnv(
  options: { urlVar?: string } = {},
  env: Env = process.env,
): DatabaseConfig {
  const authToken = envOptional('DATABASE_AUTH_TOKEN', env);
  const url = options.urlVar ? envOptional(options.urlVar, env) : undefined;
  const migrationUrl = envOptional('MIGRATION_DATABASE_URL', env);
  return {
    url: url ?? requireEnv('DATABASE_URL', env),
    max: envNumber('DB_POOL_MAX', 10, env),
    ...(authToken ? { authToken } : {}),
    ...(migrationUrl ? { migrationUrl } : {}),
    ...(envBoolean('DATABASE_SSL', false, env) ? { ssl: true } : {}),
  };
}

/** The shared cache; `ttl` is the default for `ttlVar` (`CACHE_TTL`). */
export function cacheConfigFromEnv(
  ttl: number,
  options: { ttlVar?: string } = {},
  env: Env = process.env,
): CacheConfig {
  const redisUrl = envOptional('REDIS_URL', env);
  return {
    enabled: envBoolean('CACHE_ENABLED', true, env),
    ttl: envNumber(options.ttlVar ?? 'CACHE_TTL', ttl, env),
    syncInterval: envNumber('CACHE_SYNC_INTERVAL', 5, env),
    ...(redisUrl ? { redisUrl } : {}),
  };
}

/** The media signing secret (`MEDIA_SIGNING_SECRET`, else `AUTH_SECRET`) and transform cache. */
export function mediaConfigFromEnv(
  options: { cachePathVar?: string; cachePath?: string } = {},
  env: Env = process.env,
): MediaConfig {
  return {
    signingSecret: envOptional('MEDIA_SIGNING_SECRET', env) ?? requireEnv('AUTH_SECRET', env),
    cachePath: envString(
      options.cachePathVar ?? 'MEDIA_CACHE_PATH',
      options.cachePath ?? './data/media-cache',
      env,
    ),
  };
}

/** Default `ALLOWED_MIME_TYPES`: media, text, PDF, office formats and web fonts. Spaces can narrow it. */
export const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/',
  'video/',
  'audio/',
  'text/',
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'font/woff2',
  'font/woff',
];

/** Local storage by default, S3 when `STORAGE_DRIVER=s3`, same limits either way. */
export function storageConfigFromEnv(env: Env = process.env): StorageConfig {
  const limits = {
    maxFileSize: envNumber('FILE_MAX_SIZE_MB', 25, env) * 1024 * 1024,
    allowedMimeTypes: envList('ALLOWED_MIME_TYPES', DEFAULT_ALLOWED_MIME_TYPES, env),
  };

  if (env.STORAGE_DRIVER === 's3') {
    const endpoint = envOptional('S3_ENDPOINT', env);
    const region = envOptional('S3_REGION', env);
    const publicUrl = envOptional('S3_PUBLIC_URL', env);
    return {
      driver: 's3',
      s3: {
        bucket: requireEnv('S3_BUCKET', env),
        accessKeyId: requireEnv('S3_ACCESS_KEY_ID', env),
        secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY', env),
        ...(endpoint ? { endpoint } : {}),
        ...(region ? { region } : {}),
        ...(publicUrl ? { publicUrl } : {}),
        forcePathStyle: true,
      },
      ...limits,
    };
  }

  const localPublicUrl = envOptional('STORAGE_LOCAL_PUBLIC_URL', env);
  return {
    driver: 'local',
    local: {
      path: envString('STORAGE_LOCAL_PATH', './data/uploads', env),
      ...(localPublicUrl ? { publicUrl: localPublicUrl } : {}),
    },
    ...limits,
  };
}

/** A driver's `.env` variable. */
export interface MailEnvVar {
  name: string;
  /** What a new instance's `.env` starts with, blank for secrets; absent to leave it out. */
  example?: string;
  /** Boot fails without it (`SMTP_HOST` unless `SMTP_URL` is set). */
  required: boolean;
}

/** The variables each driver reads. */
export const MAIL_DRIVER_ENV: Record<MailDriver, readonly MailEnvVar[]> = {
  smtp: [
    { name: 'SMTP_URL', required: false },
    { name: 'SMTP_HOST', example: '', required: true },
    { name: 'SMTP_PORT', example: '587', required: false },
    { name: 'SMTP_SECURE', example: 'false', required: false },
    { name: 'SMTP_USER', example: '', required: false },
    { name: 'SMTP_PASSWORD', example: '', required: false },
  ],
  mailpit: [
    { name: 'MAILPIT_HOST', example: 'localhost', required: false },
    { name: 'MAILPIT_PORT', example: '1025', required: false },
  ],
  gmail: [
    { name: 'GMAIL_CLIENT_ID', example: '', required: true },
    { name: 'GMAIL_CLIENT_SECRET', example: '', required: true },
    { name: 'GMAIL_REFRESH_TOKEN', example: '', required: true },
    { name: 'GMAIL_USER', example: 'me', required: false },
  ],
  microsoft: [
    { name: 'MICROSOFT_TENANT_ID', example: '', required: true },
    { name: 'MICROSOFT_CLIENT_ID', example: '', required: true },
    { name: 'MICROSOFT_CLIENT_SECRET', example: '', required: true },
    { name: 'MICROSOFT_SENDER', example: '', required: true },
    { name: 'MICROSOFT_SAVE_TO_SENT_ITEMS', required: false },
  ],
  resend: [{ name: 'RESEND_API_KEY', example: '', required: true }],
  sendgrid: [
    { name: 'SENDGRID_API_KEY', example: '', required: true },
    { name: 'SENDGRID_REGION', example: 'global', required: false },
  ],
  postmark: [
    { name: 'POSTMARK_SERVER_TOKEN', example: '', required: true },
    { name: 'POSTMARK_MESSAGE_STREAM', example: 'outbound', required: false },
  ],
  mailgun: [
    { name: 'MAILGUN_API_KEY', example: '', required: true },
    { name: 'MAILGUN_DOMAIN', example: '', required: true },
    { name: 'MAILGUN_REGION', example: 'us', required: false },
  ],
};

/**
 * Mail from the environment. `MAIL_DRIVER` picks the transport (`none` for no mail),
 * defaulting to `smtp` when `SMTP_URL` is set. Missing required variables fail the boot.
 */
export function mailConfigFromEnv(env: Env = process.env): MailConfig {
  const from = envOptional('MAIL_FROM', env);
  const driver = envOptional('MAIL_DRIVER', env) ?? (env.SMTP_URL ? 'smtp' : 'none');
  if (driver === 'none') return from ? { from } : {};
  return { transport: mailTransportFromEnv(driver, env), ...(from ? { from } : {}) };
}

function mailTransportFromEnv(driver: string, env: Env): MailTransportConfig {
  switch (driver) {
    case 'smtp': {
      const url = envOptional('SMTP_URL', env);
      if (url) return { driver, url };
      const user = envOptional('SMTP_USER', env);
      const password = envOptional('SMTP_PASSWORD', env);
      const port = envOptionalNumber('SMTP_PORT', env);
      return {
        driver,
        host: requireEnv('SMTP_HOST', env),
        ...(port !== undefined ? { port } : {}),
        secure: envBoolean('SMTP_SECURE', false, env),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
      };
    }
    case 'mailpit':
      return {
        driver,
        host: envString('MAILPIT_HOST', 'localhost', env),
        port: envNumber('MAILPIT_PORT', 1025, env),
      };
    case 'gmail': {
      const user = envOptional('GMAIL_USER', env);
      return {
        driver,
        clientId: requireEnv('GMAIL_CLIENT_ID', env),
        clientSecret: requireEnv('GMAIL_CLIENT_SECRET', env),
        refreshToken: requireEnv('GMAIL_REFRESH_TOKEN', env),
        ...(user ? { user } : {}),
      };
    }
    case 'microsoft':
      return {
        driver,
        tenantId: requireEnv('MICROSOFT_TENANT_ID', env),
        clientId: requireEnv('MICROSOFT_CLIENT_ID', env),
        clientSecret: requireEnv('MICROSOFT_CLIENT_SECRET', env),
        sender: requireEnv('MICROSOFT_SENDER', env),
        saveToSentItems: envBoolean('MICROSOFT_SAVE_TO_SENT_ITEMS', false, env),
      };
    case 'resend':
      return { driver, apiKey: requireEnv('RESEND_API_KEY', env) };
    case 'sendgrid':
      return {
        driver,
        apiKey: requireEnv('SENDGRID_API_KEY', env),
        region: env.SENDGRID_REGION === 'eu' ? 'eu' : 'global',
      };
    case 'postmark':
      return {
        driver,
        serverToken: requireEnv('POSTMARK_SERVER_TOKEN', env),
        messageStream: envString('POSTMARK_MESSAGE_STREAM', 'outbound', env),
      };
    case 'mailgun':
      return {
        driver,
        apiKey: requireEnv('MAILGUN_API_KEY', env),
        domain: requireEnv('MAILGUN_DOMAIN', env),
        region: env.MAILGUN_REGION === 'eu' ? 'eu' : 'us',
      };
    default:
      throw new Error(`MAIL_DRIVER '${driver}' is not one of none, ${MAIL_DRIVERS.join(', ')}`);
  }
}

/** Console logging, plus a file adapter for `LOG_FILE` and an HTTP one for `LOG_HTTP_URL`. */
export function loggingConfigFromEnv(env: Env = process.env): LoggingConfig {
  const adapters: LogAdapterConfig[] = [
    {
      type: 'console',
      ...(env.LOG_PRETTY ? { pretty: envBoolean('LOG_PRETTY', true, env) } : {}),
      ...levelOf('LOG_CONSOLE_LEVEL', env),
    },
  ];

  const file = envOptional('LOG_FILE', env);
  if (file) adapters.push({ type: 'file', path: file, ...levelOf('LOG_FILE_LEVEL', env) });

  const url = envOptional('LOG_HTTP_URL', env);
  if (url) {
    const headers = envHeaders('LOG_HTTP_HEADERS', env);
    adapters.push({
      type: 'http',
      url,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(env.LOG_HTTP_BATCH_SIZE ? { batchSize: envNumber('LOG_HTTP_BATCH_SIZE', 100, env) } : {}),
      ...levelOf('LOG_HTTP_LEVEL', env),
    });
  }

  return { level: envString('LOG_LEVEL', 'info', env), adapters };
}

function levelOf(name: string, env: Env): { level?: LogLevel } {
  const level = envOptional(name, env);
  return level ? { level: level as LogLevel } : {};
}

/** `LOG_HTTP_HEADERS="authorization: Bearer abc, x-source: api"`. */
function envHeaders(name: string, env: Env): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of envList(name, [], env)) {
    const colon = entry.indexOf(':');
    if (colon <= 0) continue;
    headers[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim();
  }
  return headers;
}
