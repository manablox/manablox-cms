import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Plugin } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminPlugin } from '../src/index.js';
import {
  type AdminBundleManifest,
  adminSfcTypes,
  defineAdminPluginBuild,
  manabloxAdminPlugins,
  SHARED_MODULES,
} from '../src/vite.js';

const VIRTUAL_ID = 'virtual:manablox/admin-plugins';

type Hook<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : never;

/** Calls a hook directly; the plugin's hooks use no rollup context. */
const call = <K extends 'resolveId' | 'load'>(plugin: Plugin, name: K, ...args: unknown[]) =>
  (plugin[name] as Hook<(...args: unknown[]) => unknown>)(...args);

describe('manabloxAdminPlugins', () => {
  it('runs before other plugins under a stable name', () => {
    const plugin = manabloxAdminPlugins();
    expect(plugin.name).toBe('manablox:admin-plugins');
    expect(plugin.enforce).toBe('pre');
  });

  it('resolves only the virtual id', () => {
    const plugin = manabloxAdminPlugins();
    expect(call(plugin, 'resolveId', VIRTUAL_ID)).toBe(`\0${VIRTUAL_ID}`);
    expect(call(plugin, 'resolveId', 'vue')).toBeNull();
    expect(call(plugin, 'load', 'vue')).toBeNull();
  });

  it('emits an empty list without plugins', () => {
    const empty = 'export const adminPlugins = [];\n';
    expect(call(manabloxAdminPlugins(), 'load', `\0${VIRTUAL_ID}`)).toBe(empty);
    expect(call(manabloxAdminPlugins({ plugins: [] }), 'load', `\0${VIRTUAL_ID}`)).toBe(empty);
  });

  it('emits an empty list in a production build, which loads plugins at runtime', () => {
    const plugin = manabloxAdminPlugins({ plugins: ['@acme/reviews/admin'] });
    (plugin.configResolved as (config: { command: string }) => void)({ command: 'build' });
    expect(call(plugin, 'load', `\0${VIRTUAL_ID}`)).toBe('export const adminPlugins = [];\n');
  });

  it('emits one static import per plugin, in order, with ids quoted safely', () => {
    const code = call(
      manabloxAdminPlugins({ plugins: ['@acme/reviews/admin', './local "quoted".ts'] }),
      'load',
      `\0${VIRTUAL_ID}`,
    );
    expect(code).toBe(
      [
        'import p0 from "@acme/reviews/admin";',
        'import p1 from "./local \\"quoted\\".ts";',
        'export const adminPlugins = [p0, p1];',
        '',
      ].join('\n'),
    );
  });
});

describe('manabloxAdminPlugins in a vite build', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mb-admin-plugin-'));
    writeFileSync(join(dir, 'Rating.js'), 'export default { name: "Rating" };\n');
    writeFileSync(join(dir, 'RatingSettings.js'), 'export default { name: "RatingSettings" };\n');
    writeFileSync(
      join(dir, 'reviews.js'),
      [
        'export default {',
        '  name: "reviews",',
        '  fields: {',
        '    inputs: { rating: () => import("./Rating.js") },',
        '    settings: { rating: () => import("./RatingSettings.js") },',
        '  },',
        '};',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'menu.js'), 'export default { name: "menu", menu: [] };\n');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads every plugin module with its lazy field and settings components', async () => {
    const server = await createServer({
      root: dir,
      logLevel: 'silent',
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [manabloxAdminPlugins({ plugins: ['/reviews.js', '/menu.js'] })],
    });
    try {
      const mod = (await server.ssrLoadModule(VIRTUAL_ID)) as { adminPlugins: AdminPlugin[] };
      expect(mod.adminPlugins.map((plugin) => plugin.name)).toEqual(['reviews', 'menu']);
      const fields = mod.adminPlugins[0]?.fields;
      expect((await fields?.inputs?.rating?.())?.default).toEqual({ name: 'Rating' });
      expect((await fields?.settings?.rating?.())?.default).toEqual({ name: 'RatingSettings' });
    } finally {
      await server.close();
    }
  });
});

describe('adminSfcTypes', () => {
  type ConfigResolved = { handler: (config: { plugins: Plugin[] }) => void; order: string };

  it("registers this package's TypeScript 5.9 with the SFC compiler of @vitejs/plugin-vue", () => {
    const registerTS = vi.fn();
    const vue = { name: 'vite:vue', api: { options: { compiler: { registerTS } } } } as Plugin;
    const hook = adminSfcTypes().configResolved as unknown as ConfigResolved;
    expect(hook.order).toBe('post');
    hook.handler({ plugins: [{ name: 'other' }, vue] });
    expect(registerTS).toHaveBeenCalledOnce();
    const load = registerTS.mock.calls[0]?.[0] as () => { version: string; sys: unknown };
    expect(load().version).toMatch(/^5\.9\./);
    expect(load().sys).toBeDefined();
  });

  it('does nothing without @vitejs/plugin-vue', () => {
    const hook = adminSfcTypes().configResolved as unknown as ConfigResolved;
    expect(() => hook.handler({ plugins: [{ name: 'other' }] })).not.toThrow();
  });
});

describe('defineAdminPluginBuild', () => {
  // Inside the package, so the shared modules resolve.
  const here = fileURLToPath(new URL('.', import.meta.url));
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(here, '.build-'));
    mkdirSync(join(root, 'src', 'admin'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "acme", "version": "2.1.0" }\n');
    writeFileSync(join(root, 'src', 'admin', 'Page.js'), 'export default { name: "Page" };\n');
    writeFileSync(join(root, 'src', 'admin', 'style.css'), '.acme { color: red; }\n');
    writeFileSync(
      join(root, 'src', 'admin', 'index.ts'),
      [
        'import { ref } from "vue";',
        'import { toast } from "@manablox/admin-sdk";',
        'import "./style.css";',
        'export default { name: "acme", ref, toast, page: () => import("./Page.js") };',
      ].join('\n'),
    );
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('shares the admin modules', () => {
    expect(SHARED_MODULES).toEqual([
      'vue',
      'vue-router',
      '@tanstack/vue-query',
      'pinia',
      'reka-ui',
      '@manablox/admin-sdk',
    ]);
  });

  it('builds entry.js, its chunks, style.css and manifest.json, with shared modules left bare', async () => {
    await build({
      ...defineAdminPluginBuild({ root, sdkLevel: 1 }),
      configFile: false,
      logLevel: 'silent',
    });
    const out = join(root, 'dist', 'admin');
    const entry = readFileSync(join(out, 'entry.js'), 'utf8');
    expect(entry).toMatch(/from\s*["']vue["']/);
    expect(entry).toMatch(/from\s*["']@manablox\/admin-sdk["']/);
    expect(entry).toMatch(/import\(["'`]\.\/Page-[\w-]+\.js["'`]\)/);
    expect(existsSync(join(out, 'style.css'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toEqual({
      version: '2.1.0',
      entry: 'entry.js',
      css: ['style.css'],
      sdkLevel: 1,
    } satisfies AdminBundleManifest);
  });

  it('resolves imported SFC types with TypeScript 5.9', () => {
    const plugins = (defineAdminPluginBuild({ root, sdkLevel: 1 }).plugins ?? []) as Plugin[];
    expect(plugins.map((plugin) => plugin.name)).toContain('manablox:admin-sfc-types');
  });

  it('refuses an sdkLevel that is not a whole number from 1', () => {
    expect(() => defineAdminPluginBuild({ root, sdkLevel: 0 })).toThrow(/sdkLevel/);
    expect(() => defineAdminPluginBuild({ root, sdkLevel: 1.5 })).toThrow(/sdkLevel/);
  });

  it('refuses a deep import of a shared module, which the import map does not carry', async () => {
    writeFileSync(
      join(root, 'src', 'admin', 'deep.js'),
      'import { api } from "@manablox/admin-sdk/lib/api";\nexport default { name: "deep", api };\n',
    );
    await expect(
      build({
        ...defineAdminPluginBuild({
          root,
          entry: 'src/admin/deep.js',
          outDir: 'dist/deep',
          sdkLevel: 1,
        }),
        configFile: false,
        logLevel: 'silent',
      }),
    ).rejects.toThrow(/import "@manablox\/admin-sdk" itself/);
  });

  it('refuses utilities without a prefix', async () => {
    writeFileSync(
      join(root, 'src', 'admin', 'bare.css'),
      '@layer utilities { .flex { display: flex } }\n',
    );
    writeFileSync(
      join(root, 'src', 'admin', 'bare.js'),
      'import "./bare.css";\nexport default {};\n',
    );
    await expect(
      build({
        ...defineAdminPluginBuild({
          root,
          entry: 'src/admin/bare.js',
          outDir: 'dist/bare',
          sdkLevel: 1,
        }),
        configFile: false,
        logLevel: 'silent',
      }),
    ).rejects.toThrow(/prefix\(xy\)/);
  });
});

describe('the utility prefix check', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  let root: string;
  const PRESET = '@import "@manablox/admin-plugin/tailwind.css"';

  beforeAll(() => {
    root = mkdtempSync(join(here, '.prefix-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Runs the check's hooks over one stylesheet source and one emitted sheet. */
  function run(source: string, css: string) {
    const file = join(root, 'style.css');
    writeFileSync(file, source);
    const plugin = (defineAdminPluginBuild({ root, sdkLevel: 1 }).plugins as Plugin[]).find(
      (entry) => entry.name === 'manablox:admin-plugin-prefix',
    ) as Plugin;
    const context = {
      error(message: string): never {
        throw new Error(message);
      },
    };
    const hook = (name: 'buildStart' | 'transform' | 'generateBundle', ...args: unknown[]) => {
      const value = plugin[name] as
        | Hook<(...args: unknown[]) => unknown>
        | { handler: Hook<(...args: unknown[]) => unknown> };
      return (typeof value === 'function' ? value : value.handler).call(context, ...args);
    };
    hook('buildStart');
    hook('transform', '', `${file}?direct`);
    hook(
      'generateBundle',
      {},
      { 'style.css': { type: 'asset', fileName: 'style.css', source: css } },
    );
  }

  it('passes prefixed utilities, also inside media queries and with nested rules', () => {
    const css =
      '@layer theme{:root{--xy-spacing:.2rem}}@layer utilities{.xy\\:flex{display:flex}' +
      '@media (width>=64rem){.xy\\:lg\\:block{display:block}}' +
      ':where(.xy\\:space-y-0\\.5>:not(:last-child)),.xy\\:p-1{margin:0;&:hover{color:red}}}.plain{color:red}';
    expect(() => run(`${PRESET} prefix(xy);`, css)).not.toThrow();
  });

  it('refuses the preset imported without a prefix', () => {
    expect(() => run(`${PRESET};`, '')).toThrow(/style\.css: import the preset .* prefix\(xy\)/);
  });

  it('names the utilities that lack the prefix', () => {
    const css =
      '@layer utilities{.xy\\:flex{display:flex}@media (width>=64rem){.lg\\:hidden{display:none}}}';
    expect(() => run(`${PRESET} prefix(xy);`, css)).toThrow(
      /without the "xy:" prefix: \.lg\\:hidden/,
    );
  });

  it('leaves a sheet without utilities alone', () => {
    expect(() => run('.acme { color: red; }', '.acme{color:red}')).not.toThrow();
  });
});
