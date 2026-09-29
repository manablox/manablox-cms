import { describe, expect, it } from 'vitest';

import { docker, file, options, render, service } from '../helpers/create.js';

describe('manablox create: files', () => {
  it('renders the full Docker stack behind Caddy', async () => {
    const files = await render(
      docker({ adminDomain: 'cms.acme.test', publicDomain: 'content.acme.test' }),
    );
    expect(files.map((entry) => entry.path)).toEqual([
      '.dockerignore',
      '.env',
      '.env.example',
      '.gitignore',
      'Dockerfile',
      'README.md',
      'caddy/Caddyfile',
      'compose.yml',
      'content-model.ts',
      'manablox.config.ts',
      'manablox.plugins.ts',
      'manablox.public.config.ts',
      'manablox.site.config.ts',
      'package.json',
      'pnpm-workspace.yaml',
      'postgres/init/10-roles.sh',
      'postgres/init/20-public-role.sh',
      'scripts/backup.sh',
      'scripts/lockfile.sh',
      'scripts/restore.sh',
      'tsconfig.json',
    ]);

    // Content types are the editors' to create; the scaffold declares none in code.
    expect(file(files, 'content-model.ts')).toContain(
      "export const contentTypes: NonNullable<ManabloxConfig['contentTypes']> = [];",
    );

    const compose = file(files, 'compose.yml');
    expect(compose).toContain('name: my-cms');
    expect(compose).toContain(`\${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}`);
    expect(compose).toContain(`PUBLIC_DOMAIN: \${PUBLIC_DOMAIN:?set PUBLIC_DOMAIN}`);
    expect(compose).not.toContain('\\${');
    expect(compose).not.toMatch(/^\s+ports:\n\s+- '\$\{ADMIN_PORT/m);
    expect(compose).toContain("- '443:443'");

    const env = file(files, '.env');
    expect(env).toContain('ADMIN_DOMAIN=cms.acme.test');
    expect(env).toContain('PUBLIC_URL=https://cms.acme.test');
    expect(env).toContain('PUBLIC_API_URL=https://content.acme.test');
    expect(env).toContain('AUTH_SECRET=AUTH');
    expect(env).toContain('POSTGRES_PASSWORD=PGPW');
    expect(env).toContain('POSTGRES_PUBLIC_PASSWORD=PGPUBPW');
    // A production stack sends no mail until a provider is picked, and boots without one.
    expect(env).toContain('MAIL_DRIVER=none');
    expect(env).not.toContain('MAIL_FROM=');
    expect(compose).not.toContain('mailpit');
    expect(file(files, 'manablox.config.ts')).toContain('mail: mailConfigFromEnv(),');

    const example = file(files, '.env.example');
    expect(example).toContain('AUTH_SECRET=\n');
    expect(example).toContain('POSTGRES_PASSWORD=\n');
    expect(example).not.toContain('PGPW');

    const manifest = JSON.parse(file(files, 'package.json')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(manifest.dependencies['@manablox/server']).toBe('^0.4.0');
    expect(manifest.scripts['start:public']).toBe(
      'manablox start --config manablox.public.config.ts',
    );
    expect(manifest.scripts['services:up']).toBeUndefined();

    expect(file(files, 'caddy/Caddyfile')).toContain('{$PUBLIC_DOMAIN} {');
    expect(file(files, 'manablox.config.ts')).toContain(
      "envString('PUBLIC_URL', 'https://cms.acme.test')",
    );
  });

  it('publishes ports instead of Caddy when asked', async () => {
    const files = await render(docker({ proxy: 'none', adminPort: 8080, publicPort: 8081 }));
    expect(files.some((entry) => entry.path === 'caddy/Caddyfile')).toBe(false);
    const compose = file(files, 'compose.yml');
    expect(compose).toContain(`- '\${ADMIN_PORT:-8080}:3000'`);
    expect(compose).toContain(`- '\${PUBLIC_PORT:-8081}:3100'`);
    expect(compose).not.toContain('caddy:');
    const env = file(files, '.env');
    expect(env).toContain('ADMIN_PORT=8080');
    expect(env).toContain('PUBLIC_URL=http://localhost:8080');
    expect(env).toContain('PUBLIC_API_URL=http://localhost:8081');
  });

  it('routes through nginx with your own certificate', async () => {
    const files = await render(
      docker({
        proxy: 'nginx',
        adminDomain: 'cms.acme.test',
        publicDomain: 'http://content.acme.test',
      }),
    );
    const paths = files.map((entry) => entry.path);
    expect(paths).toContain('nginx/templates/default.conf.template');
    expect(paths).toContain('nginx/certs/.gitignore');
    expect(paths).toContain('scripts/selfsigned-certs.sh');
    expect(paths).not.toContain('caddy/Caddyfile');

    const compose = file(files, 'compose.yml');
    expect(compose).toContain('image: nginx:1.27-alpine');
    expect(compose).toContain(
      "NGINX_ENVSUBST_FILTER: '^(ADMIN_DOMAIN|PUBLIC_DOMAIN|UPLOAD_BODY_LIMIT)$$'",
    );
    expect(compose).toContain("- '443:443'");
    expect(compose).toContain('./nginx/certs:/etc/nginx/certs:ro');
    expect(compose).not.toContain('caddy');
    expect(compose).not.toMatch(/ADMIN_PORT/);

    const conf = file(files, 'nginx/templates/default.conf.template');
    expect(conf).toContain(`server_name \${ADMIN_DOMAIN};`);
    expect(conf).toContain('return 301 https://$host$request_uri;');
    expect(conf).toContain('ssl_certificate /etc/nginx/certs/fullchain.pem;');
    expect(conf).toContain('proxy_pass http://api:3000;');
    expect(conf).toContain('proxy_pass http://public:3100;');
    // The public domain carries http://, so it is served on 80 without a redirect; every
    // other host reaches the site process.
    expect(conf.split('server {').length - 1).toBe(4);
    expect(conf).toContain('listen 80 default_server;');
    expect(conf).toContain('proxy_pass http://site:3200;');
    expect(conf).toContain('location /plugins/website/forms/ {');

    const env = file(files, '.env');
    expect(env).toContain('ADMIN_DOMAIN=cms.acme.test');
    expect(env).toContain('PUBLIC_DOMAIN=content.acme.test');
    expect(env).toContain('PUBLIC_URL=https://cms.acme.test');
    expect(env).toContain('PUBLIC_API_URL=http://content.acme.test');
    expect(env).toContain('UPLOAD_BODY_LIMIT=32m');
    expect(env).not.toContain('ACME_EMAIL');

    expect(file(files, 'scripts/selfsigned-certs.sh')).toContain(
      'subjectAltName=DNS:cms.acme.test"',
    );
  });

  it('leaves the public instance and the site process out entirely', async () => {
    const files = await render(docker({ publicApi: false }), false);
    const paths = files.map((entry) => entry.path);
    expect(paths).not.toContain('manablox.public.config.ts');
    expect(paths).toContain('postgres/init/10-roles.sh');
    // No process reads with the read-only role, so it is not created.
    expect(paths).not.toContain('postgres/init/20-public-role.sh');
    const compose = file(files, 'compose.yml');
    expect(compose).not.toContain('public:');
    expect(compose).not.toContain('POSTGRES_PUBLIC_PASSWORD');
    expect(compose).not.toContain('manablox_public');
    expect(compose).toContain('- ./postgres/init:/docker-entrypoint-initdb.d:ro');
    for (const env of ['.env', '.env.example']) {
      expect(file(files, env)).not.toContain('POSTGRES_PUBLIC_PASSWORD');
      expect(file(files, env)).not.toContain('PUBLIC_DATABASE_URL');
    }
    expect(file(files, 'manablox.plugins.ts')).not.toContain('publicPlugins');
    expect(file(files, 'README.md')).not.toContain('manablox_public');
    expect(file(files, 'caddy/Caddyfile')).not.toContain('PUBLIC_DOMAIN');
    expect(file(files, 'Dockerfile')).toContain('EXPOSE 3000\n# manablox:slot dockerfile.expose\n');
    expect(paths).not.toContain('manablox.site.config.ts');
    expect(compose).not.toContain('site');
    expect(file(files, '.env')).not.toContain('SITE_');
    expect(file(files, 'caddy/Caddyfile')).not.toContain('on_demand');
    expect(file(files, 'manablox.config.ts')).not.toContain('SITE_');
    expect(file(files, 'package.json')).not.toContain(':site');
    expect(file(files, 'README.md')).not.toContain('Designed sites');
  });

  it("adds a plugin's process, files and parts behind Caddy", async () => {
    const files = await render(docker());
    const compose = file(files, 'compose.yml');
    const site = service(compose, 'site');
    expect(site).toContain("command: ['start', '--config', 'manablox.site.config.ts']");
    expect(site).toContain(
      `DATABASE_URL: postgres://manablox_public:\${POSTGRES_PUBLIC_PASSWORD}@postgres:5432/`,
    );
    expect(site).not.toContain('ports:');
    expect(service(compose, 'caddy')).toContain('      - site\n');
    expect(compose).toMatch(/\n {2}site-media-cache:\n/);

    const caddy = file(files, 'caddy/Caddyfile');
    expect(caddy).toContain('ask http://site:3200/_manablox/domain-check');
    expect(caddy).toContain('respond /plugins/website/forms/* 404');
    expect(caddy).toContain('https:// {');
    expect(caddy).toContain('reverse_proxy site:3200 {');

    const env = file(files, '.env');
    expect(env).toContain('SITE_FORMS_SECRET=SITEFORMSSECRET');
    expect(env).toContain('SITE_URL=\n');
    expect(file(files, '.env.example')).toContain('SITE_FORMS_SECRET=\n');
    // Its process reaches the core files through marked parts too.
    expect(file(files, 'Dockerfile')).toContain(
      'EXPOSE 3000 3100\n# manablox:slot dockerfile.expose\n# manablox:plugin website >>>\nEXPOSE 3200\n',
    );
    expect(file(files, 'scripts/restore.sh')).toContain(
      'processes=(api public)\n# manablox:slot restore.processes\n# manablox:plugin website >>>\nprocesses+=(site)\n',
    );
    expect(file(files, 'scripts/restore.sh')).toContain(`docker compose stop "\${processes[@]}"`);
    expect(file(files, 'manablox.plugins.ts')).toContain('  websitePlugin(),');
    // A whole file of the plugin, rendered with the core's flags and the plugin's tokens.
    const siteConfig = file(files, 'manablox.site.config.ts');
    expect(siteConfig).toContain("mode: 'website' }");
    expect(siteConfig).toContain("envNumber('SITE_PORT', 3200)");
    expect(siteConfig).toContain("requireEnv('PUBLIC_DATABASE_URL')");
    expect(file(files, 'README.md')).toContain('## Designed sites');
  });

  it('publishes the site port without a proxy', async () => {
    const files = await render(docker({ proxy: 'none' }), { sitePort: 3300 });
    const site = service(file(files, 'compose.yml'), 'site');
    expect(site).toContain(`- '\${SITE_PORT:-3300}:3200'`);
    const env = file(files, '.env');
    expect(env).toContain('SITE_PORT=3300');
    expect(env).toContain('SITE_URL=http://localhost:3300');
  });

  it('migrates as the owner role and runs the CMS as the app role', async () => {
    const files = await render(docker());
    const compose = file(files, 'compose.yml');
    expect(compose).toContain(
      `x-app-database-url: &app-database-url postgres://\${DATABASE_APP_USER:-manablox_app}:\${DATABASE_APP_PASSWORD}@postgres:5432/`,
    );
    expect(compose).toContain(
      `x-owner-database-url: &owner-database-url postgres://\${DATABASE_OWNER_USER:-manablox_owner}:\${DATABASE_OWNER_PASSWORD}@postgres:5432/`,
    );
    for (const name of ['migrate', 'api']) {
      const block = service(compose, name);
      expect(block, name).toContain('DATABASE_URL: *app-database-url');
      expect(block, name).toContain('MIGRATION_DATABASE_URL: *owner-database-url');
    }
    for (const name of ['public', 'site']) {
      expect(service(compose, name), name).not.toMatch(/database-url|DATABASE_(OWNER|APP)_/);
    }
    expect(compose).not.toContain(`:\${POSTGRES_PASSWORD}@`);

    const postgres = service(compose, 'postgres');
    for (const name of ['DATABASE_OWNER_PASSWORD', 'DATABASE_APP_PASSWORD']) {
      expect(postgres).toContain(`${name}: \${${name}:?set ${name}}`);
    }
    expect(postgres).toContain(`DATABASE_OWNER_USER: \${DATABASE_OWNER_USER:-manablox_owner}`);
    expect(postgres).toContain('- ./postgres/init:/docker-entrypoint-initdb.d:ro');

    const env = file(files, '.env');
    expect(env).toContain('\nDATABASE_OWNER_USER=manablox_owner\n');
    expect(env).toContain('\nDATABASE_APP_USER=manablox_app\n');
    expect(env).toContain('\nDATABASE_OWNER_PASSWORD=OWNERPW\n');
    expect(env).toContain('\nDATABASE_APP_PASSWORD=APPPW\n');
    const example = file(files, '.env.example');
    expect(example).toContain('\nDATABASE_OWNER_PASSWORD=\n');
    expect(example).toContain('\nDATABASE_APP_PASSWORD=\n');

    const roles = file(files, 'postgres/init/10-roles.sh');
    expect(roles).toContain('alter schema public owner to :"owner";');
    expect(roles).toContain(`\${DATABASE_APP_USER:-manablox_app}`);
    // Runs after 10-roles.sh, so the default privilege names the owner role.
    expect(file(files, 'postgres/init/20-public-role.sh')).toContain(
      `alter default privileges for role "\${DATABASE_OWNER_USER:-manablox_owner}"`,
    );
    expect(file(files, 'README.md')).toContain('`manablox_app` is what `api` logs in as');
  });

  it('creates the read-only role for the site process without a public instance', async () => {
    const files = await render(docker({ publicApi: false }));
    expect(files.map((entry) => entry.path)).toContain('postgres/init/20-public-role.sh');
    const compose = file(files, 'compose.yml');
    expect(compose).not.toContain('\n  public:\n');
    expect(service(compose, 'postgres')).toContain('POSTGRES_PUBLIC_PASSWORD');
    expect(service(compose, 'site')).toContain('manablox_public');
    expect(file(files, '.env')).toContain('POSTGRES_PUBLIC_PASSWORD=PGPUBPW');
  });

  it('renders the local preset without the public instance or its read-only role', async () => {
    const files = await render(options({ preset: 'local', publicApi: false }), false);
    const paths = files.map((entry) => entry.path);
    expect(paths).not.toContain('manablox.public.config.ts');
    expect(paths).not.toContain('postgres/init/20-public-role.sh');
    expect(paths).toContain('postgres/init/10-roles.sh');
    for (const path of ['.env', '.env.example', 'compose.yml', 'README.md']) {
      expect(file(files, path)).not.toContain('PUBLIC_DATABASE_URL');
      expect(file(files, path)).not.toContain('POSTGRES_PUBLIC_PASSWORD');
      expect(file(files, path)).not.toContain('manablox_public');
    }
    const plugins = file(files, 'manablox.plugins.ts');
    expect(plugins).not.toContain('publicPlugins');
    expect(plugins).not.toContain('manablox:slot public.plugins');
    expect(plugins).toContain('// manablox:slot config.plugins');
  });

  it('renders the local preset with services only', async () => {
    const files = await render(
      options({
        preset: 'local',
        postgresPort: 5433,
        valkeyPort: 6380,
      }),
    );
    const paths = files.map((entry) => entry.path);
    expect(paths).not.toContain('Dockerfile');
    expect(paths).not.toContain('caddy/Caddyfile');
    expect(paths).not.toContain('scripts/backup.sh');
    expect(paths).toContain('postgres/init/20-public-role.sh');

    const compose = file(files, 'compose.yml');
    expect(compose).toContain(`- '\${POSTGRES_PORT:-5433}:5432'`);
    expect(compose).toContain(`- '\${VALKEY_PORT:-6380}:6379'`);
    expect(compose).not.toContain('api:');

    const env = file(files, '.env');
    expect(env).toContain('\nDATABASE_URL=postgres://manablox_app:APPPW@localhost:5433/manablox\n');
    expect(env).toContain(
      '\nMIGRATION_DATABASE_URL=postgres://manablox_owner:OWNERPW@localhost:5433/manablox\n',
    );
    expect(env).toContain('\nDATABASE_OWNER_PASSWORD=OWNERPW\n');
    expect(env).toContain('\nDATABASE_APP_PASSWORD=APPPW\n');
    expect(env).not.toContain(':PGPW@');
    const postgres = service(compose, 'postgres');
    expect(postgres).toContain('DATABASE_OWNER_USER: manablox_owner');
    expect(postgres).toContain('DATABASE_APP_USER: manablox_app');
    expect(postgres).toContain(
      `DATABASE_APP_PASSWORD: \${DATABASE_APP_PASSWORD:?set DATABASE_APP_PASSWORD}`,
    );
    expect(postgres).toContain('- ./postgres/init:/docker-entrypoint-initdb.d:ro');
    expect(env).toContain(
      'PUBLIC_DATABASE_URL=postgres://manablox_public:PGPUBPW@localhost:5433/manablox',
    );
    expect(env).toContain('REDIS_URL=redis://localhost:6380');
    // Locales belong to each space, set in the admin; the instance has none of its own.
    expect(env).not.toContain('LOCALES');
    expect(file(files, 'manablox.config.ts')).not.toContain('locales');

    const publicConfig = file(files, 'manablox.public.config.ts');
    expect(publicConfig).toContain("databaseConfigFromEnv({ urlVar: 'PUBLIC_DATABASE_URL' })");

    const manifest = JSON.parse(file(files, 'package.json')) as { scripts: Record<string, string> };
    expect(manifest.scripts['services:up']).toBe('docker compose up -d');
    expect(manifest.scripts['dev:public']).toContain('--watch');
    expect(manifest.scripts['dev:site']).toBe(
      'manablox start --watch --config manablox.site.config.ts',
    );
    expect(env).toContain('SITE_PORT=3200');
    expect(env).toContain('SITE_URL=http://localhost:3200');
    expect(env).toContain('SITE_FORMS_API_URL=http://localhost:3000');
    expect(env).toContain('SITE_FORMS_SECRET=SITEFORMSSECRET');
    expect(file(files, 'README.md')).toContain('`pnpm dev:site`');
  });
});
