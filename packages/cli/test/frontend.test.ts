import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import {
  createFrontend,
  defaultFrontendOptions,
  type Framework,
  frontendOptionsFromArgs,
  renderFrontendFiles,
} from '../src/frontend/index.js';
import { file } from './helpers/files.js';
import { scriptedPrompter } from './helpers/scripted-prompter.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-frontend-');

function options(framework: Framework, overrides: Record<string, unknown> = {}) {
  return { ...defaultFrontendOptions('/tmp/my-site', framework, '0.6.0'), ...overrides };
}

describe('manablox frontend: arguments', () => {
  it('reads the framework and the URLs', () => {
    const args = parseArgs([
      'frontend',
      'sites/blog',
      '--framework',
      'vue-ssr',
      '--url=https://content.acme.test',
      '--no-install',
      '--yes',
    ]);
    expect(args.command).toBe('frontend');
    expect(args.positionals).toEqual(['sites/blog']);
    expect(args.options).toEqual({ framework: 'vue-ssr', url: 'https://content.acme.test' });
    expect(args.flags).toEqual({ 'no-install': true, yes: true });
  });

  it('turns the command line into typed options and resolves the folder', () => {
    const given = frontendOptionsFromArgs(
      { framework: 'astro', url: 'https://content.acme.test/', port: '4000', 'space-id': ' abc ' },
      { 'no-git': true, force: true },
      ['blog'],
      '/work',
    );
    expect(given).toEqual({
      dir: '/work/blog',
      framework: 'astro',
      // The trailing slash is dropped: every template interpolates this as a base URL.
      url: 'https://content.acme.test',
      port: 4000,
      spaceId: 'abc',
      git: false,
      force: true,
    });
  });

  it('names the mistake', () => {
    expect(() => frontendOptionsFromArgs({ framework: 'svelte' }, {}, [], '/')).toThrow(
      /--framework must be one of plain, astro, react-ssr, vue-ssr/,
    );
    expect(() => frontendOptionsFromArgs({ url: 'localhost:3100' }, {}, [], '/')).toThrow(/--url/);
    expect(() => frontendOptionsFromArgs({ url: 'ftp://acme.test' }, {}, [], '/')).toThrow(
      /http:\/\/ or https:\/\//,
    );
    expect(() => frontendOptionsFromArgs({ name: 'My Site' }, {}, [], '/')).toThrow(/--name/);
  });

  it('derives the defaults from the folder, the framework and the CLI version', () => {
    const defaults = defaultFrontendOptions('/srv/Acme Site', 'react-ssr', '0.6.0');
    expect(defaults.name).toBe('acme-site');
    expect(defaults.manabloxVersion).toBe('^0.6.0');
    // One port per framework, so two of them can run side by side.
    expect(defaults.port).toBe(3007);
    expect(defaultFrontendOptions('/srv/site', 'astro', '0.6.0').port).toBe(3005);
  });
});

describe('manablox frontend: files', () => {
  it('writes a browser-only bundle for the plain framework', () => {
    const files = renderFrontendFiles(options('plain', { url: 'https://content.acme.test' }));
    const paths = files.map((entry) => entry.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/preview.ts');
    expect(paths).not.toContain('server.js');

    // Vite inlines these, so they carry the prefix that makes them reachable in a bundle.
    expect(file(files, '.env')).toContain('VITE_MANABLOX_URL=https://content.acme.test');
    expect(file(files, 'src/config.ts')).toContain("'https://content.acme.test'");

    const manifest = JSON.parse(file(files, 'package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.dependencies['@manablox/public-sdk']).toBe('^0.6.0');
    expect(manifest.dependencies['@manablox/live-preview']).toBe('^0.6.0');
    expect(manifest.devDependencies.vite).toBeDefined();
  });

  it('server-renders on Node for astro', () => {
    const files = renderFrontendFiles(options('astro', { port: 4005 }));
    const paths = files.map((entry) => entry.path);
    expect(paths).toContain('astro.config.mjs');
    expect(paths).toContain('src/pages/[...slug].astro');
    expect(paths).toContain('src/pages/preview.astro');

    expect(file(files, 'astro.config.mjs')).toContain('port: 4005');
    // Server-side, so no VITE_ prefix and no build-time inlining.
    expect(file(files, '.env')).toMatch(/^MANABLOX_URL=/m);
    expect(file(files, 'src/lib/manablox.ts')).toContain('process.env.MANABLOX_URL');
    expect(JSON.parse(file(files, 'package.json')).dependencies.astro).toBeDefined();
  });

  it('writes two bundles and an express server for the SSR frameworks', () => {
    for (const framework of ['react-ssr', 'vue-ssr'] as const) {
      const files = renderFrontendFiles(options(framework, { port: 4100 }));
      const paths = files.map((entry) => entry.path);
      expect(paths).toContain('server.js');
      expect(paths).toContain('index.html');
      expect(paths).toContain('src/style.css');

      expect(file(files, 'server.js')).toContain('process.env.PORT ?? 4100');
      const manifest = JSON.parse(file(files, 'package.json')) as {
        scripts: Record<string, string>;
      };
      expect(manifest.scripts['build:client']).toContain('--outDir dist/client');
      expect(manifest.scripts['build:server']).toContain('--ssr');
      expect(manifest.scripts.start).toContain('NODE_ENV=production');
    }
  });

  it('ships the SDK grid stylesheet everywhere blocks are rendered', () => {
    for (const framework of ['plain', 'astro', 'react-ssr', 'vue-ssr'] as const) {
      const files = renderFrontendFiles(options(framework));
      // From the SDK, so it matches the helpers that set the custom properties.
      expect(files.map((entry) => entry.content).join('\n')).toContain('BLOCK_GRID_CSS');
    }
  });

  it('carries the preview route and the type generator everywhere', () => {
    for (const framework of ['plain', 'astro', 'react-ssr', 'vue-ssr'] as const) {
      const files = renderFrontendFiles(options(framework));
      const contents = files.map((entry) => entry.content).join('\n');
      expect(contents).toContain('connectPreview');
      // Keeps other pages from driving the preview.
      expect(contents).toContain('editorOrigin');
      expect(JSON.parse(file(files, 'package.json')).scripts.types).toContain('manablox-sdk types');
      expect(file(files, 'README.md')).toContain('/preview');
      expect(file(files, '.gitignore')).toContain('node_modules/');
    }
  });
});

describe('manablox frontend: the templates on disk', () => {
  const FRAMEWORKS = ['plain', 'astro', 'react-ssr', 'vue-ssr'] as const;

  /** No `__TOKEN__` may reach a generated project, with non-default answers. */
  it('leaves no placeholder unfilled', () => {
    for (const framework of FRAMEWORKS) {
      const files = renderFrontendFiles(
        options(framework, {
          name: 'other-site',
          url: 'https://cms.example.test',
          editorOrigin: 'https://admin.example.test',
          port: 4321,
          spaceId: 'sp_123',
        }),
      );
      for (const entry of files) {
        // `__STATE__` is the SSR hydration global, not a placeholder.
        const left = entry.content.match(/__(?!STATE__)[A-Z_]+__/g);
        expect(left, `${framework}/${entry.path}`).toBe(null);
      }
    }
  });

  it('fills every answer that reaches a file', () => {
    const files = renderFrontendFiles(
      options('react-ssr', {
        name: 'other-site',
        url: 'https://cms.example.test',
        editorOrigin: 'https://admin.example.test',
        port: 4321,
      }),
    );
    const server = file(files, 'server.js');
    expect(server).toContain('process.env.PORT ?? 4321');
    expect(server).toContain("process.env.MANABLOX_URL ?? 'https://cms.example.test'");
    expect(server).toContain("process.env.MANABLOX_ADMIN_ORIGIN ?? 'https://admin.example.test'");
    expect(file(files, 'vite.config.ts')).toContain('port: 4321');
  });

  /** Both SSR frameworks share one Express server; only the entry differs. */
  it('gives the two SSR frameworks the same server, pointed at their own entry', () => {
    // Same port, since their defaults differ.
    const react = file(renderFrontendFiles(options('react-ssr', { port: 3000 })), 'server.js');
    const vue = file(renderFrontendFiles(options('vue-ssr', { port: 3000 })), 'server.js');
    expect(react).toContain("ssrLoadModule('/src/entry-server.tsx')");
    expect(vue).toContain("ssrLoadModule('/src/entry-server.ts')");
    expect(react.replace('/src/entry-server.tsx', '')).toBe(
      vue.replace('/src/entry-server.ts', ''),
    );
  });

  it('writes a whole tree, not a handful of files', () => {
    for (const framework of FRAMEWORKS) {
      const files = renderFrontendFiles(options(framework));
      expect(files.length).toBeGreaterThan(12);
      // No duplicate paths.
      expect(new Set(files.map((entry) => entry.path)).size).toBe(files.length);
    }
  });
});

describe('manablox frontend: the command', () => {
  it('writes the files and reports the next steps', async () => {
    const cwd = tempDir();
    const out = new PassThrough();
    let printed = '';
    out.on('data', (chunk) => {
      printed += String(chunk);
    });

    const code = await createFrontend(
      { framework: 'vue-ssr', url: 'http://localhost:3200', port: '3300' },
      { 'no-install': true, 'no-git': true, yes: true },
      ['site'],
      { cwd, prompter: null, out, cliVersion: '0.6.0' },
    );
    expect(code).toBe(0);

    const dir = join(cwd, 'site');
    expect(readdirSync(dir).sort()).toEqual([
      '.env',
      '.env.example',
      '.gitignore',
      'README.md',
      'index.html',
      'package.json',
      'pnpm-workspace.yaml',
      'server.js',
      'src',
      'tsconfig.json',
      'vite.config.ts',
    ]);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe('site');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('MANABLOX_URL=http://localhost:3200');
    expect(printed).toContain('cd site');
    expect(printed).toContain('http://localhost:3300');
  });

  it('refuses a folder with files in it unless forced', async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, 'keep.txt'), 'mine');
    const out = new PassThrough();
    out.resume();
    const context = { cwd, prompter: null, out, cliVersion: '0.6.0' };
    const flags = { 'no-install': true, 'no-git': true, yes: true };

    await expect(createFrontend({}, flags, ['.'], context)).rejects.toThrow(
      /is not empty; pass --force/,
    );
    expect(readdirSync(cwd)).toEqual(['keep.txt']);

    await expect(createFrontend({}, { ...flags, force: true }, ['.'], context)).resolves.toBe(0);
    expect(readFileSync(join(cwd, 'keep.txt'), 'utf8')).toBe('mine');
    expect(readdirSync(cwd)).toContain('astro.config.mjs');
  });
});

describe('manablox frontend: questions', () => {
  it('asks for the framework first and only for what the command line left open', async () => {
    // framework, folder, name, url, editor origin, content model, space id, port,
    // install, git.
    const prompter = scriptedPrompter([
      'react-ssr',
      'acme-site',
      '',
      'https://content.acme.test',
      '',
      'none',
      '',
      '',
      'n',
      'n',
    ]);
    const cwd = tempDir();
    const out = new PassThrough();
    out.resume();

    const code = await createFrontend({}, {}, [], { cwd, prompter, out, cliVersion: '0.6.0' });
    expect(code).toBe(0);
    expect(prompter.asked()[0]).toMatch(/built with/);

    const dir = join(cwd, 'acme-site');
    expect(readdirSync(dir)).toContain('server.js');
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    // The folder name is the default the question offered.
    expect(manifest.name).toBe('acme-site');
    expect(manifest.dependencies.react).toBeDefined();
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(
      'MANABLOX_URL=https://content.acme.test',
    );
  });
});
