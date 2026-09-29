import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/args.js';
import { create, defaultOptions, optionsFromArgs } from '../../src/create/index.js';
import { answer, docker, file, options, plugins, render, service } from '../helpers/create.js';
import { scriptedPrompter } from '../helpers/scripted-prompter.js';
import { tempDirs } from '../helpers/temp-dir.js';

const tempDir = tempDirs('manablox-create-');

describe('manablox create: SQLite', () => {
  it('takes --database and defaults to postgres', () => {
    expect(parseArgs(['create', '--database', 'sqlite']).options).toEqual({ database: 'sqlite' });
    expect(optionsFromArgs({ database: 'sqlite' }, {}, [], '/')).toEqual({ database: 'sqlite' });
    expect(() => optionsFromArgs({ database: 'mysql' }, {}, [], '/')).toThrow(
      /--database must be one of postgres, sqlite/,
    );
    expect(defaultOptions('/tmp/blog', '0.4.0').database).toBe('postgres');
  });

  it('renders the local preset with a database file and no Postgres', async () => {
    const files = await render(options({ preset: 'local', database: 'sqlite' }));
    const paths = files.map((entry) => entry.path);
    expect(paths).not.toContain('postgres/init/10-roles.sh');
    expect(paths).not.toContain('postgres/init/20-public-role.sh');
    expect(paths).toContain('manablox.public.config.ts');
    for (const entry of files) expect(entry.content, entry.path).not.toMatch(/postgres|pg_dump/i);

    const compose = file(files, 'compose.yml');
    expect(compose).toContain('  valkey:\n');
    expect(compose).toContain('  mailpit:\n');

    const env = file(files, '.env');
    expect(env).toContain('\nDATABASE_URL=file:./data/manablox.db\n');
    expect(env).not.toContain('PUBLIC_DATABASE_URL');
    expect(env).not.toContain('PGPW');
    expect(env).not.toMatch(/MIGRATION_DATABASE_URL|DATABASE_(OWNER|APP)_/);
    expect(file(files, '.gitignore').split('\n')).toContain('data/');

    for (const config of ['manablox.config.ts', 'manablox.public.config.ts']) {
      const source = file(files, config);
      expect(source).toContain('database: databaseConfigFromEnv(),');
      expect(source).not.toContain('PUBLIC_DATABASE_URL');
      expect(source).not.toContain('DATABASE_SSL');
    }

    const readme = file(files, 'README.md');
    expect(readme).toContain('`data/manablox.db`');
    expect(readme).toContain('SQLite has one');
    expect(readme).toContain('pnpm exec manablox backup');
  });

  it('keeps the database in a volume of the Docker stack', async () => {
    const files = await render(docker({ database: 'sqlite' }));
    const paths = files.map((entry) => entry.path);
    expect(paths).not.toContain('postgres/init/10-roles.sh');
    expect(paths).not.toContain('postgres/init/20-public-role.sh');
    expect(file(files, 'compose.yml')).not.toMatch(/database-url|MIGRATION_DATABASE_URL/);
    expect(file(files, '.env')).not.toMatch(/DATABASE_(OWNER|APP)_/);
    expect(paths).toContain('scripts/backup.sh');
    for (const entry of files) expect(entry.content, entry.path).not.toMatch(/postgres|pg_dump/i);

    const compose = file(files, 'compose.yml');
    expect(compose).toContain('  DATABASE_URL: file:/data/db/manablox.db\n');
    expect(compose).toMatch(/\nvolumes:\n {2}database:\n/);
    for (const name of ['migrate', 'api', 'public']) {
      expect(service(compose, name), name).toContain('      - database:/data/db\n');
    }
    expect(service(compose, 'migrate')).not.toContain('depends_on');
    expect(service(compose, 'api')).toContain(
      'migrate: { condition: service_completed_successfully }',
    );
    // WAL needs write access even to read.
    expect(service(compose, 'public')).not.toContain('database:/data/db:ro');
    expect(file(files, 'Dockerfile')).toContain(
      'mkdir -p /data/uploads /data/media-cache /data/db',
    );

    const env = file(files, '.env');
    expect(env).not.toContain('PGPW');
    expect(env).not.toContain('PGPUBPW');

    const backup = file(files, 'scripts/backup.sh');
    expect(backup).toContain(
      'docker compose exec -T api /app/node_modules/.bin/manablox backup "$snapshot"',
    );
    expect(backup).toContain('docker compose cp "api:$snapshot" "$dir/database.db"');
    expect(backup).toContain('tar -czf /backup/uploads.tar.gz');
    expect(backup).toContain('head -n -14');

    const restore = file(files, 'scripts/restore.sh');
    expect(restore).toContain('processes=(api public)\n');
    expect(restore).toContain(`docker compose stop "\${processes[@]}"`);
    expect(restore).toContain('rm -f manablox.db-wal manablox.db-shm');
    expect(restore).toContain('cp /backup/database.db manablox.db');

    const readme = file(files, 'README.md');
    expect(readme).toContain('The database is SQLite');
    expect(readme).toContain('never scale `api` to several replicas');
    expect(readme).toContain('a `manablox backup` copy of the database');
    expect(readme).not.toContain('manablox_public');
  });

  it('drops the volume from public when there is no public instance', async () => {
    const compose = file(
      await render(docker({ database: 'sqlite', publicApi: false })),
      'compose.yml',
    );
    expect(compose).not.toContain('\n  public:\n');
    expect(service(compose, 'api')).toContain('      - database:/data/db\n');
  });

  it('passes public every variable its config reads', async () => {
    const files = await render(docker({ database: 'sqlite', storage: 's3' }));
    const compose = file(files, 'compose.yml');
    const anchor = compose.slice(compose.indexOf('x-cms-env:'), compose.indexOf('\nservices:'));
    const passed = `${anchor}${service(compose, 'public')}`;
    const read = [...file(files, 'manablox.public.config.ts').matchAll(/'([A-Z][A-Z0-9_]+)'/g)];
    for (const [, name] of read) expect(passed, name).toMatch(new RegExp(`\\n\\s+${name}:`));
  });

  it('gives the site process the database volume and every variable its config reads', async () => {
    const files = await render(docker({ database: 'sqlite', storage: 's3' }));
    const compose = file(files, 'compose.yml');
    const site = service(compose, 'site');
    expect(site).toContain('      - database:/data/db\n');
    expect(site).not.toContain('manablox_public');
    const anchor = compose.slice(compose.indexOf('x-cms-env:'), compose.indexOf('\nservices:'));
    const read = [...file(files, 'manablox.site.config.ts').matchAll(/'([A-Z][A-Z0-9_]+)'/g)];
    // PUBLIC_URL is the editor origin's fallback; compose sets SITE_EDITOR_ORIGIN from it.
    for (const [, name] of read.filter(([, name]) => name !== 'PUBLIC_URL')) {
      expect(`${anchor}${site}`, name).toMatch(new RegExp(`\\n\\s+${name}:`));
    }
  });

  it('skips the Postgres port and starts only Valkey', async () => {
    // name, database, how it runs, public, the features, admin port, public port, valkey
    // port, storage, mail, install, start
    const prompter = scriptedPrompter([
      '',
      'sqlite',
      'local',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'y',
      'y',
    ]);
    const { options: answered } = await answer(
      { dir: '/tmp/blog', admin: false, space: false, git: false },
      prompter,
    );
    expect(answered).toMatchObject({ database: 'sqlite', preset: 'local', start: true });
    expect(prompter.asked()).toContain('Which database?');
    expect(prompter.asked().some((q) => q.includes('Postgres'))).toBe(false);
    expect(prompter.asked().at(-1)).toMatch(/^Start Valkey, migrate and run pnpm dev/);
  });

  it('writes the files and names only Valkey in the next steps', async () => {
    const cwd = tempDir();
    const out = new PassThrough();
    let printed = '';
    out.on('data', (chunk) => {
      printed += String(chunk);
    });

    const code = await create(
      { preset: 'local', database: 'sqlite' },
      { 'no-install': true, 'no-git': true },
      ['blog'],
      { cwd, prompter: null, out, cliVersion: '0.4.0', plugins: await plugins() },
    );
    expect(code).toBe(0);
    expect(readdirSync(join(cwd, 'blog'))).not.toContain('postgres');
    expect(readFileSync(join(cwd, 'blog/.env'), 'utf8')).toContain(
      'DATABASE_URL=file:./data/manablox.db',
    );
    expect(printed).toContain('Wrote 12 files to blog');
    expect(printed).toContain('pnpm services:up             # valkey\n');
    expect(printed).not.toMatch(/postgres/i);
  });
});
