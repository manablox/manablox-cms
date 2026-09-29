import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { create } from '../../src/create/index.js';
import { answer, plugins } from '../helpers/create.js';
import { scriptedPrompter } from '../helpers/scripted-prompter.js';
import { tempDirs } from '../helpers/temp-dir.js';

const tempDir = tempDirs('manablox-create-');

describe('manablox create: the command', () => {
  it('writes the files, marks the scripts executable and reports the next steps', async () => {
    const cwd = tempDir();
    const out = new PassThrough();
    let printed = '';
    out.on('data', (chunk) => {
      printed += String(chunk);
    });

    const code = await create(
      { preset: 'local', 'admin-port': '3010' },
      { 'no-install': true, 'no-git': true },
      ['blog'],
      { cwd, prompter: null, out, cliVersion: '0.4.0', plugins: await plugins() },
    );
    expect(code).toBe(0);

    const dir = join(cwd, 'blog');
    expect(readdirSync(dir).sort()).toEqual([
      '.env',
      '.env.example',
      '.gitignore',
      'README.md',
      'compose.yml',
      'content-model.ts',
      'manablox.config.ts',
      'manablox.plugins.ts',
      'manablox.public.config.ts',
      'package.json',
      'pnpm-workspace.yaml',
      'postgres',
      'tsconfig.json',
    ]);
    expect(statSync(join(dir, 'postgres/init/10-roles.sh')).mode & 0o111).not.toBe(0);
    expect(statSync(join(dir, 'postgres/init/20-public-role.sh')).mode & 0o111).not.toBe(0);
    expect(statSync(join(dir, 'package.json')).mode & 0o111).toBe(0);

    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/^AUTH_SECRET=[A-Za-z0-9_-]{60,}$/m);
    expect(env).toMatch(
      /^DATABASE_URL=postgres:\/\/manablox_app:[A-Za-z0-9_-]{30,}@localhost:5432\/manablox$/m,
    );
    expect(env).toMatch(
      /^MIGRATION_DATABASE_URL=postgres:\/\/manablox_owner:[A-Za-z0-9_-]{30,}@localhost:5432\/manablox$/m,
    );
    const password = (name: string) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1];
    const passwords = ['POSTGRES_PASSWORD', 'DATABASE_OWNER_PASSWORD', 'DATABASE_APP_PASSWORD'];
    expect(new Set(passwords.map(password)).size).toBe(3);
    expect(env).toContain(`manablox_app:${password('DATABASE_APP_PASSWORD')}@`);
    expect(env).toContain('PORT=3010');
    // Development defaults to Mailpit, started with the other services.
    expect(env).toContain('MAIL_DRIVER=mailpit');
    expect(readFileSync(join(dir, 'compose.yml'), 'utf8')).toContain('image: axllent/mailpit');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe('blog');

    expect(printed).toContain('Wrote 14 files to blog');
    expect(printed).toContain('cd blog');
    expect(printed).toContain('pnpm install');
    expect(printed).toContain('http://localhost:3010');
  });

  it('picks no feature by default, and the ones --features or --<id> name', async () => {
    const loaded = await plugins();
    const run = async (flags: Record<string, boolean>, options: Record<string, string> = {}) => {
      const cwd = tempDir();
      const out = new PassThrough();
      let printed = '';
      out.on('data', (chunk) => {
        printed += String(chunk);
      });
      const code = await create(
        { preset: 'local', ...options },
        { 'no-install': true, 'no-git': true, ...flags },
        ['blog'],
        { cwd, prompter: null, out, cliVersion: '0.4.0', plugins: loaded },
      );
      const dir = join(cwd, 'blog');
      const read = (path: string) => readFileSync(join(dir, path), 'utf8');
      return { code, printed, files: readdirSync(dir), read };
    };
    const dependencies = (read: (path: string) => string) =>
      Object.keys(JSON.parse(read('package.json')).dependencies);

    // The core alone: no plugin file, part, dependency or step, but every anchor.
    const core = await run({});
    expect(core.code).toBe(0);
    expect(core.files).not.toContain('manablox.site.config.ts');
    expect(dependencies(core.read).filter((name) => name.includes('plugin-'))).toEqual([]);
    expect(core.read('manablox.config.ts')).toContain(
      "import { plugins } from './manablox.plugins.ts';\n",
    );
    expect(core.read('manablox.plugins.ts')).toContain(
      '  ...shared,\n  // manablox:slot config.plugins\n];\n',
    );
    expect(core.read('manablox.plugins.ts')).not.toContain('manablox:plugin');
    expect(core.read('.env')).toContain('\n# manablox:slot env\n\n# --- Browser clients');
    expect(core.read('.env')).not.toContain('SITE_');
    expect(core.printed).toContain('--url http://localhost:3005 --template basic --owner');
    expect(core.printed).not.toContain('dev:site');

    // Every feature, each in its marked parts.
    const all = await run({}, { features: 'website,ai,workflows,webhooks', 'space-theme': 'bold' });
    expect(all.code).toBe(0);
    expect(all.files).toContain('manablox.site.config.ts');
    expect(JSON.parse(all.read('package.json')).dependencies).toMatchObject({
      '@manablox/plugin-website': '^0.4.0',
      '@manablox/plugin-ai': '^0.4.0',
      '@manablox/plugin-workflows': '^0.4.0',
      '@manablox/plugin-webhooks': '^0.4.0',
    });
    const pluginsFile = all.read('manablox.plugins.ts');
    expect(pluginsFile).toMatch(
      /\/\/ manablox:plugin ai >>>\nimport \{ aiPlugin \} from '@manablox\/plugin-ai';\n\/\/ manablox:plugin ai <<<\n/,
    );
    expect(pluginsFile).toContain(
      "  // manablox:plugin ai >>>\n  // Private-network hosts a self-hosted AI provider may reach, as `host` or `host:port`.\n  aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),\n  // manablox:plugin ai <<<\n",
    );
    expect(pluginsFile).toContain('  // manablox:plugin workflows >>>\n  workflowsPlugin(),\n');
    expect(pluginsFile).toContain('  // manablox:plugin webhooks >>>\n  webhooksPlugin(),\n');
    // One import for both lists; only the website serves public requests.
    expect(pluginsFile.match(/import \{ websitePlugin \}/g)).toHaveLength(1);
    expect(pluginsFile.slice(pluginsFile.indexOf('publicPlugins'))).not.toContain('aiPlugin');
    expect(pluginsFile.slice(pluginsFile.indexOf('publicPlugins'))).toContain('websitePlugin()');
    expect(all.read('.env')).toContain('\nAI_ALLOWED_HOSTS=\n# manablox:plugin ai <<<\n');
    expect(all.printed).toContain(
      '--url http://localhost:3200 --template basic --website designed --theme bold',
    );
    expect(all.printed).toContain(
      'pnpm dev:site                # designed sites at http://localhost:3200',
    );

    // A switch picks one.
    const ai = await run({ ai: true });
    expect(dependencies(ai.read)).toContain('@manablox/plugin-ai');
    expect(dependencies(ai.read)).not.toContain('@manablox/plugin-website');

    await expect(run({}, { 'space-theme': 'bold' })).rejects.toThrow(
      '--space-theme belongs to the website plugin, which is left out; pick it with --website',
    );
    await expect(run({ 'no-website': true }, { 'space-theme': 'bold' })).rejects.toThrow(
      '--space-theme belongs to the website plugin, which is left out; drop --no-website',
    );
    await expect(run({}, { features: 'ai', 'site-port': '3300' })).rejects.toThrow(
      '--site-port belongs to the website plugin, which is left out; add website to --features',
    );
    await expect(run({ website: true }, { 'site-port': '0' })).rejects.toThrow(
      "--site-port '0' is not a port",
    );
  });

  it('refuses a folder with files in it unless forced', async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, 'keep.txt'), 'mine');
    const out = new PassThrough();
    out.resume();
    const context = { cwd, prompter: null, out, cliVersion: '0.4.0' };
    const flags = { 'no-install': true, 'no-git': true, yes: true };

    await expect(create({}, flags, ['.'], context)).rejects.toThrow(/is not empty; pass --force/);
    expect(readdirSync(cwd)).toEqual(['keep.txt']);

    await expect(create({}, { ...flags, force: true }, ['.'], context)).resolves.toBe(0);
    expect(readFileSync(join(cwd, 'keep.txt'), 'utf8')).toBe('mine');
    expect(readdirSync(cwd)).toContain('compose.yml');
  });
});

describe('manablox create: questions', () => {
  it('asks only for what the command line left open and applies the answers', async () => {
    // name, database, how it runs, public, the features, admin port, public port (first
    // invalid, then valid), postgres port, valkey port, storage, mail, then the site port.
    const prompter = scriptedPrompter([
      'acme-blog',
      'postgres',
      'local',
      '',
      'website,ai,workflows,webhooks',
      '',
      '99999',
      '3101',
      '',
      '',
      'local',
      'postmark',
      '3201',
    ]);
    const { options: answered, applied } = await answer(
      { dir: '/tmp/blog', admin: false, space: false, install: false, git: false },
      prompter,
    );

    expect(answered).toMatchObject({
      name: 'acme-blog',
      database: 'postgres',
      preset: 'local',
      proxy: 'none',
      publicApi: true,
      // The premium plugins bring the license plugin, which is not offered on its own.
      plugins: { website: true, ai: true, workflows: true, webhooks: true, license: true },
      adminPort: 3000,
      publicPort: 3101,
      postgresPort: 5432,
      valkeyPort: 6379,
      storage: 'local',
      mail: 'postmark',
      install: false,
      git: false,
    });
    expect(applied.map((plugin) => [plugin.id, plugin.result.values])).toEqual([
      ['license', undefined],
      ['website', { sitePort: 3201 }],
      ['ai', undefined],
      ['workflows', undefined],
      ['webhooks', undefined],
    ]);
    expect(prompter.asked()).toContain('How will this instance run?');
    // One choice for the features, before the storage and mail questions.
    const asked = prompter.asked();
    const features = asked.indexOf(
      'Which features does this instance get? (none: the core alone; manablox plugin install adds one later)',
    );
    expect(features).toBeGreaterThan(-1);
    expect(features).toBeLessThan(asked.indexOf('Where do uploads live?'));
    expect(
      asked.filter((question) => /^Add (designed|AI|workflows|webhooks)/.test(question)),
    ).toEqual([]);
    expect(prompter.errors()).toEqual(["--public-port '99999' is not a port"]);
    expect(prompter.asked().some((q) => q.startsWith('Domain of the admin'))).toBe(false);
    expect(prompter.asked().some((q) => q.startsWith('Install dependencies'))).toBe(false);
  });

  it('preselects a local trial', async () => {
    // Enter on every question: name, database, how it runs, public, the features (none), two
    // ports, two service ports, storage, mail, the administrator's three, the space's two,
    // then the address, start and type.
    const prompter = scriptedPrompter(Array(19).fill(''));
    const { options: answered } = await answer(
      { dir: '/tmp/blog', install: false, git: false },
      prompter,
    );
    expect(answered).toMatchObject({
      database: 'postgres',
      preset: 'local',
      proxy: 'none',
      mail: 'mailpit',
      plugins: { website: false, ai: false, workflows: false, webhooks: false },
      admin: true,
      adminEmail: 'admin@example.com',
      adminName: 'Administrator',
      space: true,
      spaceName: 'My site',
      spaceArgs: [],
      spaceUrl: 'http://localhost:3005',
      spaceStarter: 'basic',
    });
    expect(prompter.asked()).toHaveLength(19);
  });

  it('asks for the first space, its website and theme', async () => {
    const given = {
      dir: '/tmp/blog',
      name: 'blog',
      database: 'postgres' as const,
      preset: 'local' as const,
      publicApi: true,
      plugins: { website: true, ai: true, workflows: true, webhooks: true },
      adminPort: 3000,
      publicPort: 3100,
      postgresPort: 5432,
      valkeyPort: 6379,
      storage: 'local' as const,
      mail: 'mailpit' as const,
      admin: false,
      install: false,
      git: false,
    };
    const port = { 'site-port': '3200' };

    // space, name, website, theme, url (default follows the site port), start, type
    const designed = scriptedPrompter([
      'y',
      'Acme Blog',
      'designed',
      'editorial',
      '',
      'preset',
      'blog',
    ]);
    expect((await answer(given, designed, port)).options).toMatchObject({
      space: true,
      spaceName: 'Acme Blog',
      spaceArgs: ['--website', 'designed', '--theme', 'editorial'],
      spaceUrl: 'http://localhost:3200',
      spaceStarter: 'blog',
    });

    // space, name, website, url; an own frontend has no theme
    const external = scriptedPrompter(['y', 'Acme', 'external', '', '', '']);
    expect((await answer(given, external, port)).options).toMatchObject({
      spaceArgs: [],
      spaceUrl: 'http://localhost:3005',
    });
    expect(external.asked().some((q) => q.startsWith('Which theme'))).toBe(false);

    // Without the website plugin the website question is skipped.
    const noSite = scriptedPrompter(['y', '', '', '', '']);
    const left = await answer(
      { ...given, plugins: { website: false, ai: false, workflows: false, webhooks: false } },
      noSite,
    );
    expect(left.options).toMatchObject({ spaceArgs: [], spaceUrl: 'http://localhost:3005' });
    expect(left.applied).toEqual([]);
    expect(noSite.asked().some((q) => q.startsWith('How is its website'))).toBe(false);

    const declined = scriptedPrompter(['n']);
    expect((await answer(given, declined, port)).options).toMatchObject({ space: false });
    expect(declined.asked()).toHaveLength(1);
  });

  it('skips the port questions when Caddy routes by domain', async () => {
    // the features, admin domain, acme email, install, git
    const prompter = scriptedPrompter([
      'website,ai,workflows,webhooks',
      'http://cms.localhost',
      'ops@acme.test',
      'no',
      'n',
    ]);
    const { options: answered } = await answer(
      {
        dir: '/tmp/blog',
        name: 'blog',
        database: 'postgres',
        preset: 'docker',
        proxy: 'caddy',
        publicApi: false,
        storage: 'local',
        mail: 'none',
        admin: false,
        space: false,
      },
      prompter,
    );
    expect(answered).toMatchObject({
      plugins: { website: true, ai: true, workflows: true, webhooks: true },
      adminDomain: 'http://cms.localhost',
      acmeEmail: 'ops@acme.test',
      install: false,
      git: false,
    });
    expect(prompter.asked().some((q) => q.startsWith('Domain of the public'))).toBe(false);
    expect(prompter.asked().some((q) => q.startsWith('Port of'))).toBe(false);
  });

  it('asks for domains but no certificate email with nginx', async () => {
    // how it runs, the features (none), admin domain, public domain
    const prompter = scriptedPrompter(['docker-nginx', '', 'cms.acme.test', 'content.acme.test']);
    const { options: answered, applied } = await answer(
      {
        dir: '/tmp/blog',
        name: 'blog',
        database: 'postgres',
        publicApi: true,
        storage: 'local',
        mail: 'none',
        admin: false,
        space: false,
        install: false,
        git: false,
      },
      prompter,
    );
    expect(answered).toMatchObject({
      preset: 'docker',
      proxy: 'nginx',
      adminDomain: 'cms.acme.test',
      publicDomain: 'content.acme.test',
      plugins: { website: false, ai: false, workflows: false, webhooks: false },
    });
    expect(applied).toEqual([]);
    expect(prompter.asked().some((q) => q.startsWith('Email for TLS'))).toBe(false);
  });

  it('asks whether to start only when the dependencies get installed', async () => {
    const given = {
      dir: '/tmp/blog',
      name: 'blog',
      database: 'postgres' as const,
      preset: 'local' as const,
      publicApi: false,
      plugins: { website: false, ai: false, workflows: false, webhooks: false },
      adminPort: 3000,
      postgresPort: 5432,
      valkeyPort: 6379,
      storage: 'local' as const,
      mail: 'mailpit' as const,
      admin: false,
      space: false,
      git: false,
    };

    // install, start
    const installing = scriptedPrompter(['y', 'y']);
    expect((await answer(given, installing)).options).toMatchObject({
      install: true,
      start: true,
    });
    expect(installing.asked().at(-1)).toMatch(
      /^Start Postgres and Valkey, migrate and run pnpm dev/,
    );

    // install
    const skipping = scriptedPrompter(['n']);
    expect((await answer(given, skipping)).options).toMatchObject({
      install: false,
      start: false,
    });
    expect(skipping.asked()).toEqual(['Install dependencies now with pnpm?']);
  });
});
