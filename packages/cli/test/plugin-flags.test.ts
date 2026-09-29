import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { bootstrap, type ManagementRuntime, requireManagement } from '@manablox/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { managePlugins } from '../src/commands/plugins.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-plugin-flags-', 'all');

let db: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let spaceId: string;

/** A config without imports, so it loads from a folder outside the workspace. */
function config(): Record<string, unknown> {
  return {
    database: { url: db.url },
    auth: { secret: 'plugin-flags-secret-0123456789abcdef' },
    logging: { level: 'fatal' },
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
    plugins: [{ name: 'demo', description: 'A plugin with a flag.' }],
  };
}

async function plugin(argv: string[]) {
  let out = '';
  let err = '';
  const code = await managePlugins(parseArgs(['plugin', ...argv]), {
    cwd: dir,
    prompter: null,
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
    cliVersion: '0.4.0',
    run: async () => ({ code: 0, output: '' }),
  });
  return { code, out, err };
}

beforeAll(async () => {
  db = await createTestDatabase('cli_plugin_flags');
  dir = tempDir();
  writeFileSync(
    join(dir, 'manablox.config.ts'),
    `export default ${JSON.stringify(config(), null, 2)};\n`,
  );
  writeFileSync(join(dir, 'package.json'), '{ "name": "flags", "dependencies": {} }\n');
  runtime = requireManagement(await bootstrap(config() as never));
  spaceId = (
    await runtime.spaces.create(
      { name: 'Blog', machineName: 'blog', url: 'https://blog.test' },
      null,
    )
  ).id;
});

afterAll(async () => {
  await runtime?.shutdown();
  await db?.drop();
});

describe('manablox plugin enable and disable', () => {
  it('writes the flag for the instance and for one space', async () => {
    const off = await plugin(['disable', 'demo']);
    expect(off.code, off.err).toBe(0);
    expect(off.out).toContain('the demo plugin is off for the instance (features.plugins.demo)');
    expect(await runtime.controls.settings({ kind: 'instance' })).toMatchObject({
      'features.plugins.demo': { enabled: false },
    });

    const on = await plugin(['enable', 'demo', '--space', 'blog']);
    expect(on.code, on.err).toBe(0);
    expect(on.out).toContain('the demo plugin is on for the space blog');
    expect(await runtime.controls.settings({ kind: 'space', id: spaceId })).toMatchObject({
      'features.plugins.demo': { enabled: true },
    });

    // What else the scope says about the flag stays.
    await runtime.controls.patch(
      { kind: 'instance' },
      { 'features.plugins.demo': { enabled: false, message: 'Ask the office.' } },
    );
    expect((await plugin(['enable', 'demo'])).code).toBe(0);
    expect(await runtime.controls.settings({ kind: 'instance' })).toMatchObject({
      'features.plugins.demo': { enabled: true, message: 'Ask the office.' },
    });
  });

  it('refuses a plugin that is not configured and a space that does not exist', async () => {
    const missing = await plugin(['enable', 'ai']);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      'the ai plugin is not configured on this instance; manablox plugin install ai adds it',
    );
    const nowhere = await plugin(['disable', 'demo', '--space', 'shop']);
    expect(nowhere.code).toBe(1);
    expect(nowhere.err).toContain("no space with the technical name 'shop'");
    expect((await plugin(['enable'])).err).toContain('plugin enable takes one plugin id');
  });

  it('lists the configured plugins with their flags from the database', async () => {
    const listed = await plugin(['list']);
    expect(listed.code, listed.err).toBe(0);
    expect(listed.out).toMatch(/^demo +no +yes +- +on +- +-$/m);
    expect(listed.out).not.toContain('unknown');
  });
});
