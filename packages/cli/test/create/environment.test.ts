import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { docker, file, options, render, service } from '../helpers/create.js';

describe('manablox create: environment', () => {
  /** Upper-case names quoted in a source, e.g. `envString('HOST', ...)` or `env.LOG_PRETTY`. */
  function envNames(source: string): string[] {
    const quoted = [...source.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
    const dotted = [...source.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
    return [...new Set([...quoted, ...dotted])] as string[];
  }

  /** The body of an exported function in @manablox/core's env helpers. */
  function helper(name: string): string {
    const source = readFileSync(join(import.meta.dirname, '../../../core/src/env.ts'), 'utf8');
    const start = source.indexOf(`export function ${name}(`);
    return source.slice(start, source.indexOf('\n}\n', start));
  }

  it('hands all of .env to migrate and api, and only what it reads to public', async () => {
    const files = await render(docker({ storage: 's3' }));
    const compose = file(files, 'compose.yml');
    for (const name of ['migrate', 'api']) {
      expect(service(compose, name)).toContain('env_file: .env');
    }

    const publicService = service(compose, 'public');
    expect(publicService).not.toContain('env_file');
    expect(publicService).not.toMatch(/\bPOSTGRES_PASSWORD\b/);
    expect(publicService).toContain(
      `DATABASE_URL: postgres://manablox_public:\${POSTGRES_PUBLIC_PASSWORD}@postgres`,
    );

    const read = [
      ...envNames(file(files, 'manablox.public.config.ts')),
      ...[
        'databaseConfigFromEnv',
        'cacheConfigFromEnv',
        'mediaConfigFromEnv',
        'storageConfigFromEnv',
        'loggingConfigFromEnv',
      ].flatMap((name) => envNames(helper(name))),
    ];
    // DATABASE_URL stands in for the public one; the config names its own cache TTL;
    // a Postgres stack has no Turso token; the public instance never migrates.
    const skipped = [
      'PUBLIC_DATABASE_URL',
      'CACHE_TTL',
      'DATABASE_AUTH_TOKEN',
      'MIGRATION_DATABASE_URL',
    ];
    // The shared anchor plus the service's own list.
    const anchor = compose.slice(compose.indexOf('x-cms-env:'), compose.indexOf('\nservices:'));
    const passed = `${anchor}${publicService}`;
    for (const name of read.filter((name) => !skipped.includes(name))) {
      expect(passed, name).toMatch(new RegExp(`\\n\\s+${name}:`));
    }
  });

  it('writes a .env header that fits the file', async () => {
    const files = await render(docker());
    expect(file(files, '.env')).not.toContain('Copy to');
    expect(file(files, '.env.example')).toMatch(/^# Copy to `\.env` and fill in the secrets\./);
    const local = await render(options());
    expect(file(local, '.env')).toMatch(/^# `\.env` is read twice/);
    expect(file(local, '.env.example')).toMatch(/^# Copy to `\.env`/);
  });

  it('suggests URL-safe secrets and says what AUTH_SECRET encrypts', async () => {
    for (const files of [await render(docker()), await render(options())]) {
      const env = file(files, '.env');
      expect(env).toContain('`openssl rand -hex 32`');
      expect(env).not.toContain('base64');
      expect(env).toContain('encrypts the stored credentials');
    }
    expect(file(await render(docker()), 'README.md')).toContain(
      'encrypts the stored credentials and AI provider keys',
    );
  });

  it("reads AI_ALLOWED_HOSTS in the AI plugin's part, and leaves it out without the plugin", async () => {
    const resolved = options();
    const files = await render(resolved, {}, { ai: true });
    expect(file(files, 'manablox.plugins.ts')).toContain(
      "aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) })",
    );
    // The plugin's import line, as its CLI part writes it.
    expect(file(files, 'manablox.plugins.ts')).toMatch(
      /import \{ aiPlugin \} from '@manablox\/plugin-ai';/,
    );
    expect(file(files, '.env')).toContain('\nAI_ALLOWED_HOSTS=\n');
    expect(file(files, '.env.example')).toContain('\nAI_ALLOWED_HOSTS=\n');

    const without = await render(resolved);
    expect(file(without, 'manablox.plugins.ts')).not.toContain('aiPlugin');
    expect(file(without, '.env')).not.toContain('AI_ALLOWED_HOSTS');
  });

  it('reads NET_ALLOW_PRIVATE_NETWORK', async () => {
    const files = await render(options());
    expect(file(files, 'manablox.config.ts')).toContain(
      "allowPrivateNetwork: envBoolean('NET_ALLOW_PRIVATE_NETWORK', false)",
    );
    expect(file(files, '.env')).toContain('\nNET_ALLOW_PRIVATE_NETWORK=false\n');
  });

  it('builds the whole project into the image and typechecks subfolders', async () => {
    const files = await render(docker({ proxy: 'nginx' }));
    const dockerfile = file(files, 'Dockerfile');
    expect(dockerfile).toContain('COPY --chown=manablox:manablox . ./');
    expect(dockerfile).not.toContain('*.ts');
    const ignored = file(files, '.dockerignore').split('\n');
    for (const entry of ['node_modules', 'data', 'backups', '.env', '.git', 'nginx/certs']) {
      expect(ignored).toContain(entry);
    }
    const tsconfig = JSON.parse(file(files, 'tsconfig.json')) as {
      include: string[];
      exclude: string[];
    };
    expect(tsconfig.include).toEqual(['**/*.ts']);
    expect(tsconfig.exclude).toContain('node_modules');
  });
});
