import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_DRIVERS } from '@manablox/core';
import {
  type CreateOptions,
  defaultOptions,
  finalizeOptions,
  type MailChoice,
} from './create/options.js';

/** A `.env` file's assignments; comments and blank lines skipped. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1]) out[match[1]] = (match[2] ?? '').trim();
  }
  return out;
}

/** The domain `create` took for an origin: its host, `http://`-prefixed without TLS. */
function domainOf(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' ? `http://${url.host}` : url.host;
  } catch {
    return undefined;
  }
}

function port(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : undefined;
}

/**
 * The options `manablox create` wrote an instance with, read back from its files: the preset
 * and proxy from the files it has, the rest from `.env` (or `.env.example`) and
 * `package.json`. What the files cannot tell keeps the default; `manablox plugin` needs it
 * only to render a plugin's parts the way `create` would have.
 */
export function readInstance(dir: string, cliVersion: string): CreateOptions {
  const has = (path: string) => existsSync(join(dir, ...path.split('/')));
  const env = { ...readEnvFile(join(dir, '.env.example')), ...readEnvFile(join(dir, '.env')) };
  const manifest = has('package.json')
    ? (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        dependencies?: Record<string, string>;
      })
    : {};
  const defaults = defaultOptions(dir, cliVersion);
  const preset = has('Dockerfile') ? 'docker' : 'local';
  const proxy = has('caddy/Caddyfile')
    ? 'caddy'
    : has('nginx/templates/default.conf.template')
      ? 'nginx'
      : 'none';
  const mail = env.MAIL_DRIVER;
  const byPort = preset === 'local' || proxy === 'none';
  return finalizeOptions({
    ...defaults,
    name: manifest.name ?? defaults.name,
    preset,
    proxy,
    database: has('postgres/init/10-roles.sh') ? 'postgres' : 'sqlite',
    publicApi: has('manablox.public.config.ts'),
    adminDomain: domainOf(env.PUBLIC_URL) ?? defaults.adminDomain,
    publicDomain: domainOf(env.PUBLIC_API_URL) ?? defaults.publicDomain,
    acmeEmail: env.ACME_EMAIL || defaults.acmeEmail,
    adminPort:
      port(byPort ? (preset === 'local' ? env.PORT : env.ADMIN_PORT) : undefined) ??
      defaults.adminPort,
    publicPort: port(env.PUBLIC_PORT) ?? defaults.publicPort,
    postgresPort: port(env.POSTGRES_PORT) ?? defaults.postgresPort,
    valkeyPort: port(env.VALKEY_PORT) ?? defaults.valkeyPort,
    storage: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    mail:
      mail && ([...MAIL_DRIVERS, 'none'] as string[]).includes(mail)
        ? (mail as MailChoice)
        : defaults.mail,
    admin: false,
    space: false,
    manabloxVersion: manifest.dependencies?.['@manablox/cli'] ?? defaults.manabloxVersion,
  });
}
