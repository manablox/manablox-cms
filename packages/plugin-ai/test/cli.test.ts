import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { CliInstance } from '@manablox/core';
import { afterAll, describe, expect, it } from 'vitest';
import contribution from '../src/cli/index.js';
import { aiPlugin } from '../src/server/plugin.js';

const instance: CliInstance = {
  name: 'my-cms',
  preset: 'local',
  proxy: 'none',
  database: 'postgres',
  publicApi: true,
  byDomain: false,
  adminUrl: 'http://localhost:3000',
  manabloxVersion: '^0.4.0',
  space: { name: 'My site' },
};

/** This package's folder: the CLI finds `@manablox/plugin-ai/cli` from here. */
const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('the AI plugin in the CLI', () => {
  it('adds no options of its own', () => {
    expect(contribution.options).toBeUndefined();
  });

  it('adds the plugin to the management config and its allowed hosts to .env', async () => {
    const templates = await contribution.templates?.({ instance, values: undefined });
    expect(templates?.dependencies).toEqual({ '@manablox/plugin-ai': '^0.4.0' });
    expect(templates?.slots?.['config.imports']).toBe(
      "import { aiPlugin } from '@manablox/plugin-ai';",
    );
    expect(templates?.slots?.['config.plugins']).toContain(
      "aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),",
    );
    expect(templates?.slots?.env).toContain('\nAI_ALLOWED_HOSTS=\n');
    // The public instance serves no AI.
    expect(templates?.slots?.['public.plugins']).toBeUndefined();
  });

  it('declares its CLI module in package.json, where the CLI reads it', async () => {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    // `manablox create` knows the plugin by the same id and module.
    expect(manifest.manablox).toEqual({ plugin: 'ai', cli: '@manablox/plugin-ai/cli' });
    // The CLI pairs a configured plugin with its package by the plugin's id; the plugin
    // object's own `cli` (for local plugins) stays unset so the help sees the same.
    expect(aiPlugin().name).toBe('ai');
    expect(aiPlugin().cli).toBeUndefined();
    const module = (await import('@manablox/plugin-ai/cli')) as { default: unknown };
    expect(module.default).toBe(contribution);
    expect(contribution.summary).toBeTypeOf('string');
  });
});

describe('manablox create with the AI plugin', () => {
  const run = promisify(execFile);
  const cli = join(
    dirname(createRequire(import.meta.url).resolve('@manablox/cli')),
    '..',
    'bin',
    'manablox.mjs',
  );
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  /** Runs the published `manablox create` beside this package, which it picks up. */
  async function create(...flags: string[]) {
    const root = await mkdtemp(join(tmpdir(), 'manablox-ai-cli-'));
    dirs.push(root);
    const dir = join(root, 'cms');
    await run(
      process.execPath,
      [
        cli,
        'create',
        dir,
        '--yes',
        '--no-install',
        '--no-git',
        '--manablox-version',
        '^0.4.0',
        ...flags,
      ],
      { cwd: packageDir, env: { ...process.env, XDG_CACHE_HOME: join(root, 'cache') } },
    );
    return (path: string) => readFile(join(dir, path), 'utf8');
  }

  it('writes the plugin into its marked parts', async () => {
    const read = await create('--ai');
    expect(JSON.parse(await read('package.json')).dependencies).toMatchObject({
      '@manablox/plugin-ai': '^0.4.0',
    });
    const plugins = await read('manablox.plugins.ts');
    expect(plugins).toMatch(
      /\/\/ manablox:plugin ai >>>\nimport \{ aiPlugin \} from '@manablox\/plugin-ai';\n\/\/ manablox:plugin ai <<<\n/,
    );
    expect(plugins).toContain(
      "  // manablox:plugin ai >>>\n  // Private-network hosts a self-hosted AI provider may reach, as `host` or `host:port`.\n  aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),\n  // manablox:plugin ai <<<\n",
    );
    // Only the management instance loads it.
    expect(plugins.slice(plugins.indexOf('publicPlugins'))).not.toContain('aiPlugin');
    expect(await read('.env')).toContain('\nAI_ALLOWED_HOSTS=\n# manablox:plugin ai <<<\n');
    expect(await read('.env.example')).toContain('\nAI_ALLOWED_HOSTS=\n');
  });

  it('leaves every part of it out when AI is not picked', async () => {
    const read = await create('--no-ai');
    expect(JSON.parse(await read('package.json')).dependencies).not.toHaveProperty(
      '@manablox/plugin-ai',
    );
    expect(await read('manablox.plugins.ts')).not.toContain('aiPlugin');
    expect(await read('.env')).not.toContain('AI_ALLOWED_HOSTS');
  });
});
