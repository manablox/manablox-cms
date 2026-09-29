import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import type { ManabloxPlugin } from '@manablox/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { policy } from '../src/middleware/csp.js';
import {
  adminPluginRoutes,
  adminRoutes,
  inlineScriptHashes,
  resolveAdminDir,
} from '../src/routes/admin.js';
import { negotiateEncoding } from '../src/routes/admin-files.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-admin-', 'all');

const BIG_JS = `export const words = ${JSON.stringify('manablox '.repeat(400))};`;
const IMPORT_MAP = '{"imports":{"@manablox/admin-sdk":"/assets/shared-manablox-admin-sdk-x1.js"}}';

/** A built admin; `app-def456.js` comes with the `.br` / `.gz` copies the build writes. */
function builtAdmin(): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="importmap">${IMPORT_MAP}</script></head><body><div id="app"></div></body></html>`,
  );
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'app-def456.js'), BIG_JS);
  writeFileSync(join(dir, 'assets', 'app-def456.js.br'), brotliCompressSync(BIG_JS));
  writeFileSync(join(dir, 'assets', 'app-def456.js.gz'), gzipSync(BIG_JS));
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  return dir;
}

describe('adminRoutes', () => {
  const app = new Hono();
  app.get('/rpc/ping', (c) => c.json({ ok: true }));
  app.route('/', adminRoutes(builtAdmin()));

  it('serves index.html at the root, uncached', async () => {
    const res = await app.request('/', { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="app"');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves hashed assets as immutable', async () => {
    const res = await app.request('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to index.html for a deep link a browser asks for', async () => {
    const res = await app.request('/spaces/abc/content', {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="app"');
  });

  it('does not hand a page to a client that did not ask for one', async () => {
    const res = await app.request('/no/such/file.json', {
      headers: { accept: 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('leaves API routes alone', async () => {
    const res = await app.request('/rpc/ping', { headers: { accept: 'text/html' } });
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sends the precompressed copy the client prefers, with its length and a vary', async () => {
    const br = await app.request('/assets/app-def456.js', {
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toBe('accept-encoding');
    expect(br.headers.get('cache-control')).toContain('immutable');
    expect(br.headers.get('content-type')).toContain('text/javascript');
    const bytes = Buffer.from(await br.arrayBuffer());
    expect(Number(br.headers.get('content-length'))).toBe(bytes.length);
    expect(brotliDecompressSync(bytes).toString()).toBe(BIG_JS);

    const gz = await app.request('/assets/app-def456.js', {
      headers: { 'accept-encoding': 'gzip, br;q=0' },
    });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(BIG_JS);

    const plain = await app.request('/assets/app-def456.js');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(plain.headers.get('vary')).toBe('accept-encoding');
    expect(await plain.text()).toBe(BIG_JS);
  });

  it('answers 304 for the ETag of the coding the client holds', async () => {
    const headers = { 'accept-encoding': 'br' };
    const first = await app.request('/assets/app-def456.js', { headers });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toMatch(/-br"$/);
    const again = await app.request('/assets/app-def456.js', {
      headers: { ...headers, 'if-none-match': etag },
    });
    expect(again.status).toBe(304);
    const other = await app.request('/assets/app-def456.js', {
      headers: { 'accept-encoding': 'gzip', 'if-none-match': etag },
    });
    expect(other.status).toBe(200);
  });

  it('does not serve the compressed copies as files', async () => {
    expect((await app.request('/assets/app-def456.js.br')).status).toBe(404);
  });

  it('inlines an empty plugin list without plugins, and preloads nothing', async () => {
    const res = await app.request('/', { headers: { accept: 'text/html' } });
    const html = await res.text();
    expect(html).toContain(
      '<script type="application/json" id="manablox-plugins">{"plugins":[]}</script>',
    );
    expect(html).not.toContain('modulepreload');
    expect(res.headers.get('etag')).toMatch(/^"/);
  });
});

describe('negotiateEncoding', () => {
  const both = ['br', 'gzip'] as const;

  it('prefers brotli and honours q-values and wildcards', () => {
    expect(negotiateEncoding('gzip, deflate, br', both)).toBe('br');
    expect(negotiateEncoding('br;q=0.5, gzip', both)).toBe('gzip');
    expect(negotiateEncoding('br;q=0, gzip;q=0', both)).toBeNull();
    expect(negotiateEncoding('*', both)).toBe('br');
    expect(negotiateEncoding('x-gzip', ['gzip'])).toBe('gzip');
    expect(negotiateEncoding('identity', both)).toBeNull();
    expect(negotiateEncoding(undefined, both)).toBeNull();
    expect(negotiateEncoding('br', [])).toBeNull();
  });
});

describe('resolveAdminDir', () => {
  it('accepts a directory that holds a built admin', () => {
    const dir = builtAdmin();
    expect(resolveAdminDir(dir)).toBe(dir);
  });

  it('refuses a directory without an index.html', () => {
    expect(() => resolveAdminDir(tempDir())).toThrow(/config.admin.notFound/);
  });
});

/** A plugin's built admin folder: manifest, entry, lazy chunks and a sheet. */
function pluginBundle(files: Record<string, string> = {}): string {
  const dir = tempDir();
  const manifest = { version: '1.2.0', entry: 'entry.js', css: ['style.css'], sdkLevel: 1 };
  const all = {
    'manifest.json': JSON.stringify(manifest),
    'entry.js': 'export default { name: "hello" };',
    'Page-abc.js': 'export default {};',
    'Big-abc.js': BIG_JS,
    'style.css': '.hello{}',
    ...files,
  };
  for (const [name, text] of Object.entries(all)) writeFileSync(join(dir, name), text);
  return dir;
}

const plugin = (name: string, dir?: string): ManabloxPlugin => ({
  name,
  ...(dir ? { admin: { dir } } : {}),
});

describe('plugin admin bundles', () => {
  const warnings: unknown[] = [];
  const debug: unknown[] = [];
  const app = new Hono();
  app.route(
    '/',
    adminRoutes(builtAdmin(), {
      plugins: [
        plugin('hello', pluginBundle()),
        plugin('@acme/seo', pluginBundle()),
        plugin('no-admin'),
        plugin('broken', tempDir()),
        plugin('unbuilt', join(tempDir(), 'dist', 'admin')),
      ],
      logger: {
        warn: (details) => warnings.push(details),
        debug: (details) => debug.push(details),
      },
    }),
  );

  async function manifest() {
    const res = await app.request('/admin/plugins.json');
    return { res, body: (await res.json()) as { plugins: Array<Record<string, unknown>> } };
  }

  it('lists each bundle with hashed URLs, its flag and its SDK level, uncached', async () => {
    const { res, body } = await manifest();
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(body.plugins.map((entry) => entry.id)).toEqual(['hello', 'acme.seo']);
    const [hello] = body.plugins;
    expect(hello).toMatchObject({
      name: 'hello',
      version: '1.2.0',
      feature: 'plugins.hello',
      sdkLevel: 1,
    });
    expect(hello?.entry).toMatch(/^\/admin\/plugins\/hello\/[0-9a-f]{12}\/entry\.js$/);
    expect(hello?.css).toEqual([String(hello?.entry).replace('entry.js', 'style.css')]);
  });

  it('skips a folder without a manifest and says so', async () => {
    const { body } = await manifest();
    expect(body.plugins.some((entry) => entry.id === 'broken')).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('skips a plugin whose admin folder was never built without a warning', async () => {
    const { body } = await manifest();
    expect(body.plugins.some((entry) => entry.id === 'unbuilt')).toBe(false);
    expect(warnings).not.toContainEqual(expect.objectContaining({ plugin: 'unbuilt' }));
    expect(debug).toEqual([expect.objectContaining({ plugin: 'unbuilt' })]);
  });

  it('serves bundle files as immutable, typed by extension', async () => {
    const { body } = await manifest();
    const entry = String(body.plugins[0]?.entry);
    const js = await app.request(entry);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await js.text()).toContain('hello');
    const chunk = await app.request(entry.replace('entry.js', 'Page-abc.js'));
    expect(chunk.status).toBe(200);
    const css = await app.request(entry.replace('entry.js', 'style.css'));
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  it('compresses bundle files once, in memory, and leaves small ones as they are', async () => {
    const { body } = await manifest();
    const entry = String(body.plugins[0]?.entry);
    const big = entry.replace('entry.js', 'Big-abc.js');
    const headers = { 'accept-encoding': 'gzip, br' };
    const br = await app.request(big, { headers });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toBe('accept-encoding');
    const bytes = Buffer.from(await br.arrayBuffer());
    expect(Number(br.headers.get('content-length'))).toBe(bytes.length);
    expect(brotliDecompressSync(bytes).toString()).toBe(BIG_JS);
    const again = await app.request(big, {
      headers: { ...headers, 'if-none-match': br.headers.get('etag') ?? '' },
    });
    expect(again.status).toBe(304);

    const small = await app.request(entry, { headers });
    expect(small.headers.get('content-encoding')).toBeNull();
    expect(small.headers.get('vary')).toBeNull();
  });

  it('inlines the list into index.html and preloads the entries, the SDK and the sheets', async () => {
    const { body } = await manifest();
    const res = await app.request('/spaces/x/hello', { headers: { accept: 'text/html' } });
    const html = await res.text();
    const inlined = /<script type="application\/json" id="manablox-plugins">(.*?)<\/script>/.exec(
      html,
    )?.[1];
    expect(JSON.parse(inlined ?? 'null')).toEqual(body);
    expect(html).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/shared-manablox-admin-sdk-x1.js">',
    );
    for (const plugin of body.plugins) {
      expect(html).toContain(`<link rel="modulepreload" crossorigin href="${plugin.entry}">`);
      const [sheet] = plugin.css as string[];
      expect(html).toContain(`<link rel="preload" as="style" href="${sheet}">`);
    }
  });

  it('answers 404 for a stale hash, an unknown plugin, a missing file or a path outside', async () => {
    const { body } = await manifest();
    const entry = String(body.plugins[0]?.entry);
    const stale = entry.replace(/\/[0-9a-f]{12}\//, '/000000000000/');
    expect((await app.request(stale)).status).toBe(404);
    expect((await app.request(entry.replace('/hello/', '/nobody/'))).status).toBe(404);
    expect((await app.request(entry.replace('entry.js', 'missing.js'))).status).toBe(404);
    expect((await app.request(entry.replace('entry.js', '..%2F..%2Fetc%2Fpasswd'))).status).toBe(
      404,
    );
  });

  it('changes the URL when the bundle is rebuilt', async () => {
    const entryOf = async (dir: string) => {
      const routes = adminRoutes(builtAdmin(), { plugins: [plugin('hello', dir)] });
      const body = (await (await routes.request('/admin/plugins.json')).json()) as {
        plugins: Array<{ entry: string }>;
      };
      return body.plugins[0]?.entry;
    };
    const before = await entryOf(pluginBundle());
    const after = await entryOf(pluginBundle({ 'entry.js': 'export default 2' }));
    expect(before).not.toBe(after);
  });

  it('lists nothing without plugins', async () => {
    const routes = adminRoutes(builtAdmin());
    expect(await (await routes.request('/admin/plugins.json')).json()).toEqual({ plugins: [] });
  });

  it('serves the bundles without the admin, for an admin served elsewhere', async () => {
    const routes = adminPluginRoutes([plugin('hello', pluginBundle())]);
    const body = (await (await routes.request('/admin/plugins.json')).json()) as {
      plugins: Array<{ entry: string }>;
    };
    const entry = String(body.plugins[0]?.entry);
    expect((await routes.request(entry)).status).toBe(200);
    expect((await routes.request('/')).status).toBe(404);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes the inline scripts, such as the import map, and skips external ones', () => {
    const dir = tempDir();
    const map = '{"imports":{"vue":"/assets/shared-vue.js"}}';
    writeFileSync(
      join(dir, 'index.html'),
      `<script type="importmap">${map}</script><script type="module" src="/assets/index.js"></script>`,
    );
    const hashes = inlineScriptHashes(dir);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
    const value = policy(
      { enabled: true, reportOnly: false, frameSrc: [], imgSrc: [], connectSrc: [] },
      hashes,
    );
    expect(value).toContain(`script-src 'self' ${hashes[0]}`);
  });
});
