import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/args.js';
import { defaultOptions, optionsFromArgs } from '../../src/create/index.js';
import { startSteps } from '../../src/create/start.js';
import { firstPartyPlugins } from '../../src/plugins.js';
import { docker, options } from '../helpers/create.js';
import { tempDirs } from '../helpers/temp-dir.js';

const tempDir = tempDirs('manablox-create-');

describe('manablox create: arguments', () => {
  it('keeps the folder as a positional after the command', () => {
    const args = parseArgs(['create', 'sites/blog', '--preset', 'local', '--no-public', '--yes']);
    expect(args.command).toBe('create');
    expect(args.positionals).toEqual(['sites/blog']);
    expect(args.options).toEqual({ preset: 'local' });
    expect(args.flags).toEqual({ 'no-public': true, yes: true });
  });

  it('rejects an option it does not know', () => {
    expect(() => parseArgs(['create', '--colour', 'blue'])).toThrow(/unknown option '--colour'/);
  });

  it('turns the command line into typed options and resolves the folder', () => {
    const given = optionsFromArgs(
      {
        preset: 'docker',
        proxy: 'none',
        'admin-port': '4000',
        storage: 's3',
      },
      { 'no-public': true, 'no-install': true, force: true },
      ['blog'],
      '/work',
    );
    expect(given).toEqual({
      dir: '/work/blog',
      preset: 'docker',
      proxy: 'none',
      adminPort: 4000,
      storage: 's3',
      publicApi: false,
      install: false,
      force: true,
    });
  });

  it("reads the first-party plugins' switches and options", async () => {
    const plugins = await firstPartyPlugins(process.cwd());
    const args = parseArgs(['create', 'blog', '--no-website', '--site-port', '3300'], plugins);
    expect(args.flags).toEqual({ 'no-website': true });
    expect(args.options).toEqual({ 'site-port': '3300' });
    expect(
      optionsFromArgs(args.options, args.flags, args.positionals, '/work', ['website']),
    ).toEqual({ dir: '/work/blog', plugins: { website: false } });
    expect(() => parseArgs(['create', '--site-port', '3300'])).toThrow(
      /unknown option '--site-port' for 'create'/,
    );
  });

  it('picks the exact list of --features, and refuses it mixed with the switches', () => {
    const picked = (features: string) => optionsFromArgs({ features }, {}, [], '/work').plugins;
    const none = { website: false, ai: false, workflows: false, webhooks: false, license: false };
    // The license plugin the AI plugin requires is added once the choice is applied.
    expect(picked('ai,workflows')).toEqual({ ...none, ai: true, workflows: true });
    expect(picked('none')).toEqual(none);
    expect(picked('')).toEqual(none);
    expect(() => picked('ai,shop')).toThrow(
      "--features: 'shop' is not one of website, ai, workflows, webhooks, license (or none for the core alone)",
    );
    expect(() => picked('ai, ai')).toThrow("--features names 'ai' twice");
    expect(() => optionsFromArgs({ features: 'ai' }, { 'no-website': true }, [], '/')).toThrow(
      '--features and --no-website both pick the features; use one',
    );
    expect(optionsFromArgs({}, { website: true }, [], '/').plugins).toEqual({ website: true });
    expect(parseArgs(['create', '--features', 'ai']).options).toEqual({ features: 'ai' });
  });

  it('names the mistake', () => {
    expect(() => optionsFromArgs({ preset: 'kubernetes' }, {}, [], '/')).toThrow(
      /--preset must be one of local, docker/,
    );
    expect(() => optionsFromArgs({ 'admin-port': '99999' }, {}, [], '/')).toThrow(/--admin-port/);
    expect(() =>
      optionsFromArgs({ 'admin-domain': 'https://cms.example.com' }, {}, [], '/'),
    ).toThrow(/--admin-domain/);
    expect(() => optionsFromArgs({ 'acme-email': 'nobody' }, {}, [], '/')).toThrow(/--acme-email/);
    expect(() => optionsFromArgs({ name: 'My CMS' }, {}, [], '/')).toThrow(/--name/);
    expect(() => optionsFromArgs({ mail: 'pigeon' }, {}, [], '/')).toThrow(
      /--mail must be one of smtp, mailpit, gmail, microsoft, resend, sendgrid, postmark, mailgun, none/,
    );
    expect(optionsFromArgs({ mail: 'microsoft' }, {}, [], '/')).toMatchObject({
      mail: 'microsoft',
    });
  });

  it('derives the defaults from the folder and the CLI version', () => {
    const defaults = defaultOptions('/srv/Acme Sites', '0.4.0');
    expect(defaults.name).toBe('acme-sites');
    expect(defaults.manabloxVersion).toBe('^0.4.0');
    // Nothing is picked: the core alone.
    expect(defaults.plugins).toEqual({
      website: false,
      ai: false,
      workflows: false,
      webhooks: false,
      license: false,
    });
  });

  it('defaults to a local trial with Mailpit', () => {
    expect(options()).toMatchObject({ preset: 'local', proxy: 'none', mail: 'mailpit' });
  });

  it('takes a proxy as the docker preset', () => {
    expect(optionsFromArgs({ proxy: 'nginx' }, {}, [], '/')).toEqual({
      preset: 'docker',
      proxy: 'nginx',
    });
    expect(optionsFromArgs({ preset: 'local', proxy: 'nginx' }, {}, [], '/').preset).toBe('local');
  });

  it('drops the proxy for the local preset', () => {
    expect(options({ preset: 'local' }).proxy).toBe('none');
  });

  it('starts nothing unless asked, and only on an install', () => {
    expect(defaultOptions('/tmp/blog', '0.4.0').start).toBe(false);
    expect(parseArgs(['create', '--start']).flags).toEqual({ start: true });
    expect(optionsFromArgs({}, { start: true }, [], '/')).toEqual({ start: true });
    expect(optionsFromArgs({}, { 'no-start': true }, [], '/')).toEqual({ start: false });
    expect(() => optionsFromArgs({}, { start: true, 'no-install': true }, [], '/')).toThrow(
      /--start needs the dependencies installed/,
    );
  });
});

describe('manablox create: starting', () => {
  it('builds and starts the Docker stack, with a certificate for nginx when there is none', () => {
    const dir = tempDir();
    const commands = (overrides: Partial<ReturnType<typeof defaultOptions>>) =>
      startSteps(docker(overrides), dir).map((step) => [step.command, ...step.args].join(' '));

    expect(commands({ admin: false, space: false })).toEqual(['docker compose up -d --build']);
    expect(commands({ proxy: 'nginx', admin: false, space: false })).toEqual([
      './scripts/selfsigned-certs.sh',
      'docker compose up -d --build',
    ]);
    mkdirSync(join(dir, 'nginx/certs'), { recursive: true });
    writeFileSync(join(dir, 'nginx/certs/fullchain.pem'), 'cert');
    expect(commands({ proxy: 'nginx', admin: false, space: false })).toEqual([
      'docker compose up -d --build',
    ]);
  });

  it('starts the services and migrates for local development', () => {
    const steps = startSteps(options({ preset: 'local', admin: false, space: false }), tempDir());
    expect(steps.map((step) => [step.command, ...step.args].join(' '))).toEqual([
      'docker compose up -d --wait',
      'pnpm migrate',
    ]);
  });

  it('creates the administrator and then the space it owns, in Docker through the migrate container', () => {
    const shown = (steps: ReturnType<typeof startSteps>) =>
      steps.map((step) => [step.command, ...step.args].join(' '));
    const local = startSteps(
      options({
        preset: 'local',
        adminPassword: 'secret-secret',
        pluginSpaceUrl: 'http://localhost:3200',
        spaceArgs: ['--website', 'designed', '--theme', 'neutral', '--design', 'atlas'],
      }),
      tempDir(),
    );
    expect(shown(local).slice(-2)).toEqual([
      'pnpm exec manablox user create --email admin@example.com --name Administrator',
      'pnpm exec manablox space create --name My site --machine-name my-site' +
        ' --url http://localhost:3200 --template basic --website designed --theme neutral' +
        ' --design atlas' +
        ' --owner admin@example.com',
    ]);
    // The password travels in the environment only.
    expect(local.at(-2)?.env).toEqual({ MANABLOX_USER_PASSWORD: 'secret-secret' });
    expect(
      shown(
        startSteps(
          docker({
            admin: false,
            spaceName: 'Blog',
            spaceStarter: null,
          }),
          tempDir(),
        ),
      ),
    ).toEqual([
      'docker compose up -d --build',
      'docker compose run --rm migrate space create --name Blog --machine-name blog' +
        ' --url http://localhost:3005',
    ]);
    expect(shown(startSteps(docker({ space: false }), tempDir())).at(-1)).toBe(
      'docker compose run --rm -e MANABLOX_USER_PASSWORD migrate user create' +
        ' --email admin@example.com --name Administrator',
    );
  });
});
