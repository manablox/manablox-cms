#!/usr/bin/env node
// Flags admin imports that cross the folder rule in apps/admin/DEVELOPMENT.md. The admin
// and admin-sdk sources share one layout; `@manablox/admin-sdk/x` and relative imports count
// as `~/x`. Plugin admin sources may import only the packages a plugin bundle can use, and
// plugin packages follow one layout (see below).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { lineOf, report, walk } from './lib/scan.mjs';

const args = process.argv.slice(2);
const roots = (args.length > 0 ? args : ['apps/admin/src', 'packages/admin-sdk/src']).map((dir) =>
  resolve(dir),
);
const IMPORT = /from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g;

/** Admin plugin sources, each built into its own bundle. */
const PLUGIN_ROOTS = [
  'packages/plugin-license/src/admin',
  'packages/plugin-webhooks/src/admin',
  'packages/plugin-workflows/src/admin',
].map((dir) => resolve(dir));

/** Packages a plugin bundle imports at runtime: the admin's shared modules and browser-safe libraries. */
const PLUGIN_PACKAGES = new Set([
  '@manablox/admin-sdk',
  '@manablox/admin-plugin',
  '@manablox/core',
  '@manablox/live-preview',
  '@tanstack/vue-query',
  // The workflow canvas, bundled by the workflows plugin.
  '@vue-flow/background',
  '@vue-flow/controls',
  '@vue-flow/core',
  '@vue-flow/minimap',
  '@vueuse/core',
  'pinia',
  'reka-ui',
  'vue',
  'vue-router',
]);

/** Every source file with its root. */
const sources = roots.flatMap((root) => [...walk(root)].map((absolute) => ({ root, absolute })));

/** `spec` as a `~/` path, or null for a package or an import leaving the root. */
function normalise(root, absolute, spec) {
  if (spec.startsWith('~/')) return spec;
  if (spec.startsWith('@manablox/admin-sdk/'))
    return `~/${spec.slice('@manablox/admin-sdk/'.length)}`;
  if (!spec.startsWith('.')) return null;
  const path = relative(root, join(dirname(absolute), spec))
    .split(sep)
    .join('/');
  return path.startsWith('..') ? null : `~/${path}`;
}

/** The feature a path under `features/` belongs to, else null. */
function featureOf(path) {
  const match = /^features\/([^/]+)\//.exec(path);
  return match ? match[1] : null;
}

/* Cross-feature component imports that predate the rule. Nothing is added here. */
const KNOWN_CROSS_FEATURE = new Set([]);

/**
 * One-way feature dependencies whose components may be used: `from -> to`. Any other
 * feature imports another's `queries` or `model`; a component two features need moves to
 * `components/`.
 */
const ALLOWED_DEPENDENCIES = new Set(['webhooks -> credentials']);

/** Each rule sees the importing file (relative to src, posix) and one import specifier. */
const RULES = [
  {
    id: 'ui-imports-feature',
    applies: (file) => file.startsWith('components/ui/'),
    violates: (_file, spec) => /^~\/(features|stores|pages)\//.test(spec),
    message: 'components/ui is presentational; it imports nothing from features, stores or pages',
  },
  {
    id: 'cross-feature-component',
    applies: (file) => featureOf(file) !== null,
    violates: (file, spec) => {
      const target = /^~\/features\/([^/]+)\/components\//.exec(spec);
      if (target === null || target[1] === featureOf(file)) return false;
      return !ALLOWED_DEPENDENCIES.has(`${featureOf(file)} -> ${target[1]}`);
    },
    skip: (file, spec) => KNOWN_CROSS_FEATURE.has(`${file} -> ${spec}`),
    message:
      "a component of another feature; share it from components/ or use that feature's queries or model",
  },
  {
    id: 'lib-imports-feature',
    applies: (file) => file.startsWith('lib/'),
    violates: (_file, spec) => /^~\/(features|pages)\//.test(spec),
    message: 'lib holds shared utilities; feature code lives in features/<feature>',
  },
];

/** The api types each feature's `queries.ts` re-exports, which its own files import from there. */
const API_TYPES = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*\/lib\/api-types'/g;
const REEXPORT = /export\s+type\s+\{([^}]*)\}\s+from\s+'[^']*\/lib\/api-types'/g;
const names = (list) =>
  list
    .split(',')
    .map((name) => name.replace(/^\s*type\s+/, '').trim())
    .filter(Boolean);
const reexported = new Map();
for (const { root, absolute } of sources) {
  const file = relative(root, absolute).split(sep).join('/');
  const feature = /^features\/([^/]+)\/queries\.ts$/.exec(file)?.[1];
  if (!feature) continue;
  const text = readFileSync(absolute, 'utf8');
  reexported.set(
    feature,
    new Set([...text.matchAll(REEXPORT)].flatMap((match) => names(match[1]))),
  );
}

const findings = [];
const seenExceptions = new Set();
for (const { root, absolute } of sources) {
  const file = relative(root, absolute).split(sep).join('/');
  const text = readFileSync(absolute, 'utf8');
  if (/^features\/[^/]+\/lib\//.test(file)) {
    findings.push({
      where: relative(process.cwd(), absolute),
      found: file,
      message: 'a feature keeps its helpers at its root or in model.ts, not in a lib/ folder',
    });
  }
  const own = reexported.get(featureOf(file));
  if (own && !file.endsWith('/queries.ts')) {
    for (const match of text.matchAll(API_TYPES)) {
      const hit = names(match[1]).filter((name) => own.has(name));
      if (hit.length === 0) continue;
      findings.push({
        where: `${relative(process.cwd(), absolute)}:${lineOf(text, match.index)}`,
        found: hit.join(', '),
        message: "re-exported by the feature's queries.ts; import it from there",
      });
    }
  }
  for (const match of text.matchAll(IMPORT)) {
    const spec = normalise(root, absolute, match[1] ?? match[2]);
    if (spec === null) continue;
    for (const rule of RULES) {
      if (!rule.applies(file) || !rule.violates(file, spec)) continue;
      if (rule.skip?.(file, spec)) {
        seenExceptions.add(`${file} -> ${spec}`);
        continue;
      }
      findings.push({
        where: `${relative(process.cwd(), absolute)}:${lineOf(text, match.index)}`,
        found: spec,
        message: rule.message,
      });
    }
  }
}

const TYPE_IMPORT = /^(?:import|export)\s+type\s/;

for (const root of PLUGIN_ROOTS) {
  for (const absolute of walk(root)) {
    const text = readFileSync(absolute, 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const spec = match[1] ?? match[2];
      const start = Math.max(
        text.lastIndexOf('\nimport ', match.index),
        text.lastIndexOf('\nexport ', match.index),
        0,
      );
      const typeOnly = TYPE_IMPORT.test(text.slice(start, match.index).trimStart());
      const where = `${relative(process.cwd(), absolute)}:${lineOf(text, match.index)}`;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(absolute), spec).replace(/\.[jt]s$/, '');
        // The package's browser-safe `src/sdk` is fine at runtime too.
        const sdk = target === resolve(root, '..', 'sdk');
        if (!typeOnly && !sdk && relative(root, target).startsWith('..')) {
          findings.push({
            where,
            found: spec,
            message: 'plugin server code in the admin bundle; import only its types',
          });
        }
        continue;
      }
      if (typeOnly) continue;
      const name = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      if (!PLUGIN_PACKAGES.has(name)) {
        findings.push({
          where,
          found: spec,
          message: 'not available to an admin plugin bundle; use @manablox/admin-sdk',
        });
      } else if (name === '@manablox/admin-sdk' && spec !== name) {
        findings.push({
          where,
          found: spec,
          message: "the admin shares only @manablox/admin-sdk's main entry",
        });
      }
    }
  }
}

/*
 * The plugin layout (https://dev.manablox.io/extending/plugins/, "Package layout"). Admin bundle: the root
 * holds the entry, the client, keys, queries, exposed apis, composables and styles; plain
 * TypeScript goes to model/, components to components/, pages/ or slots/. Server: one of
 * services.ts / services/ and rpc.ts / rpc/, service classes in services/, and a folder
 * only when it holds several files.
 */
const ADMIN_ROOT_FILES = new Set([
  'index.ts',
  'client.ts',
  'keys.ts',
  'queries.ts',
  'api.ts',
  'admin-api.ts',
  'slots.ts',
]);
const ADMIN_FOLDERS = new Set(['model', 'components', 'pages', 'slots']);
const ANY_FILE = /./;
const rel = (absolute) => relative(process.cwd(), absolute);

for (const root of PLUGIN_ROOTS) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      if (!ADMIN_FOLDERS.has(entry)) {
        findings.push({
          where: rel(path),
          found: `${entry}/`,
          message: 'an admin bundle has model/, components/, pages/ and slots/ folders only',
        });
      }
      continue;
    }
    // Styles, images and type shims may sit at the root.
    if (entry.endsWith('.d.ts') || !/\.(ts|vue)$/.test(entry)) continue;
    if (ADMIN_ROOT_FILES.has(entry) || /^use[A-Z]\w*\.ts$/.test(entry)) continue;
    findings.push({
      where: rel(path),
      found: entry,
      message: entry.endsWith('.vue')
        ? 'components live in components/, pages/ or slots/'
        : 'helpers live in model/; composables are use*.ts',
    });
  }
  const model = join(root, 'model');
  if (existsSync(model)) {
    for (const absolute of walk(model, { ext: /\.vue$/ })) {
      findings.push({
        where: rel(absolute),
        found: 'model/',
        message: 'model/ holds plain TypeScript',
      });
    }
  }
}

const SERVER_ROOTS = [...PLUGIN_ROOTS.map((admin) => join(dirname(admin), 'server'))].filter(
  (dir) => existsSync(dir),
);

for (const root of SERVER_ROOTS) {
  const has = (name) => existsSync(join(root, name));
  for (const [file, folder] of [
    ['services.ts', 'services'],
    ['rpc.ts', 'rpc'],
  ]) {
    if (has(file) && has(folder)) {
      findings.push({
        where: rel(root),
        found: `${file} and ${folder}/`,
        message: `one of them: ${file} for one file, ${folder}/ for several`,
      });
    }
  }
  if (has('service')) {
    findings.push({
      where: rel(join(root, 'service')),
      found: 'service/',
      message: 'the services folder is services/',
    });
  }
  if (!has('plugin.ts')) {
    findings.push({
      where: rel(root),
      found: 'plugin.ts',
      message: 'the definePlugin call lives in server/plugin.ts',
    });
  }
  for (const absolute of walk(root, { ext: ANY_FILE })) {
    const file = relative(root, absolute).split(sep).join('/');
    if (file.endsWith('.service.ts') && !file.startsWith('services/')) {
      findings.push({
        where: rel(absolute),
        found: file,
        message: 'service classes live in services/',
      });
    }
  }
  const folders = [root];
  while (folders.length > 0) {
    const folder = folders.pop();
    const entries = readdirSync(folder);
    if (folder !== root && entries.length < 2) {
      findings.push({
        where: rel(folder),
        found: entries.join(', '),
        message: 'a folder with one file becomes that file',
      });
    }
    for (const entry of entries) {
      if (statSync(join(folder, entry)).isDirectory()) folders.push(join(folder, entry));
    }
  }
}

// An exception nobody uses any more is removed, so the list only shrinks.
for (const known of KNOWN_CROSS_FEATURE) {
  if (!seenExceptions.has(known)) {
    findings.push({
      where: 'scripts/check-admin-layout.mjs',
      found: known,
      message: 'stale exception; remove it',
    });
  }
}

report(
  'admin layout',
  findings,
  `${RULES.length + 1} rules and the plugin layout, ${KNOWN_CROSS_FEATURE.size} known exceptions`,
);
