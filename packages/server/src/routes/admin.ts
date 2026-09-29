import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ManabloxError, type ManabloxPlugin, pluginFeatureKey, pluginId } from '@manablox/core';
import { Hono } from 'hono';
import {
  diskFile,
  IMMUTABLE,
  memoryFile,
  type ServedFile,
  sendFile,
  unkeptFile,
} from './admin-files.js';

/** The configured admin dir, else `@manablox/admin`'s `dist` resolved from cwd, then this package. */
export function resolveAdminDir(configured: string | null): string {
  if (configured) {
    if (!existsSync(join(configured, 'index.html'))) {
      throw ManabloxError.badRequest('config.admin.notFound', { dir: configured });
    }
    return configured;
  }

  const bases = [join(process.cwd(), 'package.json'), import.meta.url];
  for (const base of bases) {
    try {
      const manifest = createRequire(base).resolve('@manablox/admin/package.json');
      const dir = join(dirname(manifest), 'dist');
      if (existsSync(join(dir, 'index.html'))) return dir;
    } catch {
      // Not resolvable from here; try the next base.
    }
  }

  throw ManabloxError.badRequest('config.admin.notFound', { package: '@manablox/admin' });
}

/** A plugin's admin bundle as `/admin/plugins.json` lists it. */
export interface AdminPluginBundle {
  id: string;
  name: string;
  version: string | null;
  entry: string;
  css: string[];
  feature: string;
  /** The lowest admin SDK API level the bundle needs. */
  sdkLevel: number;
}

/** A bundle with its content hash and its files, as the server serves it. */
interface ServedBundle extends AdminPluginBundle {
  hash: string;
  /** By path relative to the bundle folder, `/`-separated. */
  files: Map<string, ServedFile>;
}

const PLUGIN_PREFIX = '/admin/plugins';
/**
 * Plugin bundle bytes kept in memory per process, compressed copies aside. Bundles are read
 * once at boot to hash them; files past this are read from disk per request, uncompressed.
 */
const PLUGIN_MEMORY_BYTES = 64 * 1024 * 1024;

interface WarnLogger {
  warn(details: object, message: string): void;
  debug?(details: object, message: string): void;
}

/**
 * The admin bundles of `plugins` (those with `admin.dir`). A plugin whose folder does not
 * exist has no admin build (a checkout that has not built it) and is skipped quietly; a
 * folder without a readable `manifest.json` is skipped with a warning. Their files are what the folder held at boot:
 * the URL hash names that content, so a rebuilt bundle takes a restart.
 */
function adminPluginBundles(
  plugins: readonly ManabloxPlugin[],
  logger?: WarnLogger,
): ServedBundle[] {
  const bundles: ServedBundle[] = [];
  const budget = { left: PLUGIN_MEMORY_BYTES };
  for (const plugin of plugins) {
    const dir = plugin.admin?.dir;
    if (!dir) continue;
    const id = pluginId(plugin.name);
    if (!existsSync(dir)) {
      logger?.debug?.({ plugin: id, dir }, 'plugin has no admin build');
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
        version?: string | null;
        entry?: string;
        css?: string[];
        sdkLevel?: number;
      };
      if (typeof manifest.entry !== 'string' || !Number.isInteger(manifest.sdkLevel)) {
        throw new Error('manifest.json needs `entry` and `sdkLevel`');
      }
      const { hash, files } = bundleFiles(resolve(dir), budget);
      const url = (file: string) => `${PLUGIN_PREFIX}/${id}/${hash}/${file}`;
      bundles.push({
        id,
        name: plugin.name,
        version: manifest.version ?? plugin.version ?? null,
        entry: url(manifest.entry),
        css: (manifest.css ?? []).map(url),
        feature: pluginFeatureKey(plugin),
        sdkLevel: manifest.sdkLevel as number,
        hash,
        files,
      });
    } catch (error) {
      logger?.warn({ err: error, plugin: id, dir }, 'plugin admin bundle skipped');
    }
  }
  return bundles;
}

/**
 * Every file under `dir` and a short hash of them all, so a rebuilt bundle gets new URLs.
 * Files are kept in memory while `budget` lasts.
 */
function bundleFiles(
  dir: string,
  budget: { left: number },
): { hash: string; files: Map<string, ServedFile> } {
  const folder = createHash('sha256');
  const files = new Map<string, ServedFile>();
  for (const path of filesUnder(dir).sort()) {
    const name = relative(dir, path).split(sep).join('/');
    const bytes = readFileSync(path);
    folder.update(relative(dir, path));
    folder.update(bytes);
    const etag = createHash('sha256').update(bytes).digest('base64url').slice(0, 22);
    if (bytes.length <= budget.left) {
      budget.left -= bytes.length;
      files.set(name, memoryFile(name, bytes, etag));
    } else {
      files.set(name, unkeptFile(path, etag));
    }
  }
  return { hash: folder.digest('hex').slice(0, 12), files };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The bundle list as `/admin/plugins.json` and the admin's `index.html` carry it. */
function listed(bundles: readonly ServedBundle[]): AdminPluginBundle[] {
  return bundles.map(({ hash: _hash, files: _files, ...bundle }) => bundle);
}

/** `/admin/plugins.json` and the bundles' files under `/admin/plugins/<id>/<hash>/`. */
function pluginBundleRoutes(app: Hono, bundles: readonly ServedBundle[]): void {
  const list = { plugins: listed(bundles) };
  app.get(`${PLUGIN_PREFIX}.json`, (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.json(list);
  });
  app.get(`${PLUGIN_PREFIX}/:id/:hash/*`, async (c) => {
    const bundle = bundles.find((entry) => entry.id === c.req.param('id'));
    if (!bundle || bundle.hash !== c.req.param('hash')) return c.notFound();
    const prefix = `${PLUGIN_PREFIX}/${bundle.id}/${bundle.hash}/`;
    let name: string;
    try {
      name = decodeURIComponent(c.req.path.slice(prefix.length));
    } catch {
      return c.notFound();
    }
    const file = bundle.files.get(name);
    if (!file) return c.notFound();
    return sendFile(c, file, IMMUTABLE);
  });
}

/** CSP hashes of the inline scripts in the admin's `index.html` (the import map, the theme). */
export function inlineScriptHashes(dir: string): string[] {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
}

/** The plugin bundle routes alone, for an admin served elsewhere that proxies them here. */
export function adminPluginRoutes(plugins: readonly ManabloxPlugin[], logger?: WarnLogger): Hono {
  const app = new Hono();
  pluginBundleRoutes(app, adminPluginBundles(plugins, logger));
  return app;
}

export interface AdminRoutesOptions {
  /** Plugins whose admin bundles are served next to the admin. */
  plugins?: readonly ManabloxPlugin[];
  logger?: WarnLogger;
}

/**
 * Serves the admin SPA, matching `docker/nginx.admin.conf`, and the plugins' admin bundles.
 * Unmatched paths return `index.html` to browsers and 404 to other clients. Files go out in
 * the coding the client prefers: the build's `.br` / `.gz` copies, the plugin bundles and
 * `index.html` compressed in memory.
 */
export function adminRoutes(dir: string, options: AdminRoutesOptions = {}): Hono {
  const app = new Hono();
  const root = resolve(dir);
  const bundles = adminPluginBundles(options.plugins ?? [], options.logger);
  const page = indexPage(root, bundles);
  // Only files that exist are kept, so this grows no larger than the build.
  const files = new Map<string, ServedFile>();

  pluginBundleRoutes(app, bundles);
  app.get('/*', async (c, next) => {
    const path = c.req.path;
    if (path === '/' || path === '/index.html') return sendFile(c, await page(), 'no-cache');
    const file = await adminFile(root, path, files);
    if (file) return sendFile(c, file, path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
    if (!c.req.header('accept')?.includes('text/html')) return next();
    return sendFile(c, await page(), 'no-cache');
  });

  return app;
}

/** The build's file at `path`; null outside `root`, when missing, or for a compressed copy. */
async function adminFile(
  root: string,
  path: string,
  files: Map<string, ServedFile>,
): Promise<ServedFile | null> {
  const known = files.get(path);
  if (known) return known;
  let file: string;
  try {
    file = resolve(root, `.${decodeURIComponent(path)}`);
  } catch {
    return null;
  }
  if (!file.startsWith(root + sep) || /\.(?:br|gz)$/.test(file)) return null;
  const found = await diskFile(file);
  if (found) files.set(path, found);
  return found;
}

/**
 * The admin's `index.html` with the plugin list inlined, so the admin skips fetching
 * `/admin/plugins.json`, and `modulepreload` links for the plugin entries (and the SDK they
 * import), so they download alongside the admin's own modules. Rendered again when the
 * file changes on disk.
 */
function indexPage(root: string, bundles: readonly ServedBundle[]): () => Promise<ServedFile> {
  const path = join(root, 'index.html');
  let rendered: { key: string; file: ServedFile } | null = null;
  return async () => {
    const info = await stat(path);
    const key = `${info.size}-${info.mtimeMs}`;
    if (rendered?.key !== key) {
      const html = Buffer.from(withPlugins(readFileSync(path, 'utf8'), bundles));
      const etag = createHash('sha256').update(html).digest('base64url').slice(0, 22);
      rendered = { key, file: memoryFile('index.html', html, etag) };
    }
    return rendered.file;
  };
}

/** The element id of the inlined plugin list, which `apps/admin`'s plugin loader reads. */
const PLUGIN_LIST_ID = 'manablox-plugins';

function withPlugins(html: string, bundles: readonly ServedBundle[]): string {
  // `<` escaped, so nothing in the list can close the element.
  const list = JSON.stringify({ plugins: listed(bundles) }).replace(/</g, '\\u003c');
  const tags = [`<script type="application/json" id="${PLUGIN_LIST_ID}">${list}</script>`];
  if (bundles.length > 0) {
    const preload = (href: string) =>
      `<link rel="modulepreload" crossorigin href="${escapeAttribute(href)}">`;
    const sdk = importMapTarget(html, '@manablox/admin-sdk');
    if (sdk) tags.push(preload(sdk));
    for (const bundle of bundles) {
      tags.push(preload(bundle.entry));
      for (const href of bundle.css) {
        tags.push(`<link rel="preload" as="style" href="${escapeAttribute(href)}">`);
      }
    }
  }
  return html.replace('</head>', `  ${tags.join('\n    ')}\n  </head>`);
}

/** Where the admin's import map points `specifier`, else null. */
function importMapTarget(html: string, specifier: string): string | null {
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!map) return null;
  try {
    const target = (JSON.parse(map) as { imports?: Record<string, unknown> }).imports?.[specifier];
    return typeof target === 'string' ? target : null;
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);
}
