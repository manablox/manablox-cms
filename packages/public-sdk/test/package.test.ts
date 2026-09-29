import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The package must stay dependency-free. */
describe('package shape', () => {
  it('has no runtime dependencies', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it('keeps preview behind its own entry point', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toContain('./preview');

    // The main entry must not reach the credential-carrying preview module.
    const index = await readFile(join(ROOT, 'src/index.ts'), 'utf8');
    expect(index).not.toContain('preview');
  });

  it('imports no Node built-in outside the CLI', async () => {
    const files = (await readdir(join(ROOT, 'src'))).filter(
      (name) => name.endsWith('.ts') && !name.startsWith('cli'),
    );

    for (const name of files) {
      const source = await readFile(join(ROOT, 'src', name), 'utf8');
      expect(source, name).not.toMatch(/from '(node:|fs|path|url|crypto|http)/);
    }
  });
});

/** The SDK runs in browsers, workers and Node, so it uses no runtime-specific globals. */
describe('runtime portability', () => {
  it('references no DOM or Node global outside the CLI', async () => {
    const files = (await readdir(join(ROOT, 'src'))).filter(
      (name) => name.endsWith('.ts') && !name.startsWith('cli'),
    );

    for (const name of files) {
      const source = await readFile(join(ROOT, 'src', name), 'utf8');
      // Ignore comments.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const global of ['window.', 'document.', 'process.', 'Buffer.', '__dirname']) {
        expect(code, `${name} references ${global}`).not.toContain(global);
      }
    }
  });

  it('loads and works with no DOM present', async () => {
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined');

    const { createClient } = await import('../src/index.js');
    const sdk = createClient({
      url: 'https://cms.example.com',
      transport: 'rest',
      fetch: (async () =>
        new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }), {
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof globalThis.fetch,
    });

    await expect(sdk.list()).resolves.toMatchObject({ items: [] });
  });
});
