#!/usr/bin/env node
// Fails when a core package or the admin's sources import a first-party feature plugin or
// the libraries only it may use, or name what the plugin owns. The plugin packages are the
// only places for either.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Each feature plugin: its package, the libraries only it uses, and names only it may use. */
const PLUGINS = [
  {
    packages: ['plugin-workflows'],
    names:
      /WorkflowService\b|WorkflowEngine|workflowRepos|\btable\(\s*['"]workflows['"]|WorkflowRegistry|WorkflowActionRegistry|defineWorkflow(?:Action|Trigger|AbortTrigger)?\b|workflowRuns|workflows_runs|workflowVersions|workflows_versions|activeWorkflows|workflowHttp|workflowMail|@vue-flow|features\.workflows\b|plugins\.workflows\b|['"]workflows?:(?:read|write|run|pruneRuns|live|(?:before|after)[A-Z]\w*)['"]|(?:get|isOn|has|usePluginApi)(?:<[^>]*>)?\(\s*['"]workflows['"]/,
  },
  {
    packages: ['plugin-license'],
    names:
      /LicenseService\b|licenseRepos|LicenseActivationRepository|license_activations|licenseActivations|features\.plugins\.license\b|plugins\.license\b|(?:get|isOn|has|require|usePluginApi)(?:<[^>]*>)?\(\s*['"]license['"]/,
  },
  {
    packages: ['plugin-webhooks'],
    names:
      /defineWebhook\b|webhookTrigger\(|webhookAbort\(|WEBHOOK_RESOURCE_KIND|WebhookService\b|WebhookRepository|webhookAuditor|webhookRepos|WebhookView\b|WebhookDeliveryView|webhookDeliveries|webhooks_deliveries|webhookDeliveriesDays|repos\.webhooks\b|\btable\(\s*['"]webhooks['"]|\/api\/hooks\/|hooks\.incoming|features\.webhooks\b|limits\.webhooks\b|plugins\.webhooks\b|['"]webhooks\.(?:webhook|webhooks)['"]|['"]webhooks?:(?:read|write|deliver|beforeCreate|received)['"]|(?:get|isOn|has|usePluginApi)(?:<[^>]*>)?\(\s*['"]webhooks['"]/,
  },
];

/** Every plugin package. */
const PLUGIN_PACKAGES = new Set(PLUGINS.flatMap((plugin) => plugin.packages));

/** Allowed without an import: the CLI's optional peers, whose CLI modules it loads by id. */
const DEPENDING = new Map([
  [
    'cli',
    new Set([
      '@manablox/plugin-license',
      '@manablox/plugin-workflows',
      '@manablox/plugin-webhooks',
    ]),
  ],
]);

const IMPORT = new RegExp(
  `(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]@manablox\\/(${[...PLUGIN_PACKAGES].join('|')})(?:\\/[^'"]*)?['"]`,
);
const EXTENSIONS = /\.(?:ts|mts|mjs|js|vue)$/;
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (EXTENSIONS.test(name)) yield path;
  }
}

const problems = [];
const packages = join(root, 'packages');
for (const name of readdirSync(packages).sort()) {
  if (PLUGIN_PACKAGES.has(name)) continue;
  const dir = join(packages, name);
  if (!statSync(dir).isDirectory()) continue;
  const manifest = join(dir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const dep of Object.keys(deps)) {
      const plugin = dep.startsWith('@manablox/') && PLUGIN_PACKAGES.has(dep.slice(10));
      if (plugin && !DEPENDING.get(name)?.has(dep)) {
        problems.push(`packages/${name}/package.json: depends on ${dep}`);
      }
    }
  } catch {
    continue;
  }
  for (const file of files(dir)) checkFile(file);
}
// The admin's own sources; only its dev server config loads the plugins.
for (const file of files(join(root, 'apps/admin/src'))) checkFile(file);

function checkFile(file) {
  const path = relative(root, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const imported = line.match(IMPORT);
    if (imported) {
      problems.push(`${path}:${index + 1}: imports ${imported[0]}`);
      return;
    }
    for (const { names } of PLUGINS) {
      const named = line.match(names);
      if (named) {
        problems.push(`${path}:${index + 1}: names ${named[0]}`);
        return;
      }
    }
  });
}

if (problems.length) {
  console.error('Core packages must not use the feature plugins:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
