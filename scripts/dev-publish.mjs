// Publishes the tarballs `scripts/publish.sh --pack-only` built to the development stack's
// local registry. Run by `scripts/dev-publish.sh`, on the host or in the api container.
//
//   node scripts/dev-publish.mjs --dir <tarballs> --registry <url> --version <v> --tag <t>
//
// Each tarball is unpacked, set to `--version` (the `@manablox/*` dependencies between
// them too, so a dev build only ever resolves its siblings), and published with npm. A
// version that is already on the registry is unpublished first: the local registry is
// scratch space, and republishing the same version is the point.
//
// It never talks to anything but a registry on this machine or the compose network: the
// URL is checked before anything runs, and npm gets it on the command line (the highest
// precedence) with every inherited npm setting removed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    registry: { type: 'string' },
    version: { type: 'string' },
    tag: { type: 'string', default: 'latest' },
  },
});

function fail(message) {
  console.error(`dev-publish: ${message}`);
  process.exit(1);
}

if (!values.dir || !values.registry || !values.version) {
  fail('--dir, --registry and --version are required');
}

// Hosts that can only be this machine or the dev stack's networks, where the registry is
// `verdaccio` (the stack's own network and `manablox-registry`).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'verdaccio']);

let registry;
try {
  registry = new URL(values.registry);
} catch {
  fail(`'${values.registry}' is not a URL`);
}
if (registry.protocol !== 'http:' || !LOCAL_HOSTS.has(registry.hostname)) {
  fail(
    `refusing to publish to ${registry.href}: only a local registry (http on ${[...LOCAL_HOSTS].join(', ')}) is allowed. Releases go through .github/workflows/release.yml.`,
  );
}
if (!registry.pathname.endsWith('/')) registry.pathname += '/';
const registryUrl = registry.href;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(values.version)) {
  fail(`'${values.version}' is not a version`);
}
const version = values.version;
const tag = values.tag;

const dir = resolve(values.dir);
const staging = join(dir, 'staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// A config file of our own, so no ~/.npmrc, project .npmrc or global config is read: one
// of those could name another registry for the scope, or hold a real npmjs token. The
// token here is a placeholder - npm will not publish without one, and the registry lets
// anyone publish `@manablox/*` (docker/verdaccio/config.yaml).
// Outside the staging folder, which is npm's working directory: a `.npmrc` there would be
// read a second time as the project config, and npm refuses that.
const npmConfig = join(dir, 'npm-config');
mkdirSync(npmConfig, { recursive: true });
const npmrc = join(npmConfig, 'userconfig');
const globalNpmrc = join(npmConfig, 'globalconfig');
writeFileSync(globalNpmrc, '');
const authKey = `//${registry.host}${registry.pathname}:_authToken`;
writeFileSync(
  npmrc,
  `registry=${registryUrl}\n@manablox:registry=${registryUrl}\n${authKey}=dev-publish\n`,
);

// Inherited npm settings outrank a config file: `pnpm run` exports its whole config as
// `npm_config_*`, the registry included.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
);
env.NPM_CONFIG_USERCONFIG = npmrc;
env.NPM_CONFIG_GLOBALCONFIG = globalNpmrc;

function npm(args, { quiet = false } = {}) {
  const result = spawnSync(
    'npm',
    [...args, '--registry', registryUrl, `--@manablox:registry=${registryUrl}`],
    { cwd: staging, env, encoding: 'utf8' },
  );
  if (!quiet && result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }
  return result;
}

// The registry answers before anything is unpacked, so a stopped stack fails fast.
try {
  const ping = await fetch(new URL('-/ping', registryUrl));
  if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
} catch (error) {
  fail(`${registryUrl} does not answer (${error.message}) - start it with 'pnpm dev:services'`);
}

const tarballs = readdirSync(dir)
  .filter((file) => file.endsWith('.tgz'))
  .sort();
if (tarballs.length === 0) fail(`no tarballs in ${dir}`);

// Unpack every tarball first: the set of names is what the dependency rewrite needs.
const packages = tarballs.map((file) => {
  const target = join(staging, file.replace(/\.tgz$/, ''));
  mkdirSync(target, { recursive: true });
  const untar = spawnSync('tar', ['-xzf', join(dir, file), '-C', target, '--strip-components=1']);
  if (untar.status !== 0) fail(`could not unpack ${file}: ${untar.stderr}`);
  const manifestFile = join(target, 'package.json');
  return { target, manifestFile, manifest: JSON.parse(readFileSync(manifestFile, 'utf8')) };
});
const local = new Set(packages.map(({ manifest }) => manifest.name));

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

for (const { manifestFile, manifest } of packages) {
  manifest.version = version;
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (local.has(name)) manifest[field][name] = version;
    }
  }
  // pnpm already applied it while packing; what is left (`access`, a `registry`) could
  // only send the publish somewhere else.
  delete manifest.publishConfig;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(
  `dev-publish: publishing ${packages.length} packages at ${version} ('${tag}') to ${registryUrl}`,
);

for (const { target, manifest } of packages) {
  const id = `${manifest.name}@${version}`;
  const existing = npm(['view', id, 'version'], { quiet: true });
  if (existing.status === 0 && existing.stdout.trim() === version) {
    const removed = npm(['unpublish', id, '--force']);
    if (removed.status !== 0) fail(`could not unpublish ${id}`);
  }
  // `--ignore-scripts`: the tarball is already built; a lifecycle script would only
  // rebuild it, or fail on a missing dev dependency.
  const published = npm(['publish', target, '--tag', tag, '--ignore-scripts']);
  if (published.status !== 0) fail(`could not publish ${id}`);
  console.log(`  ${id}`);
}

rmSync(staging, { recursive: true, force: true });
rmSync(npmConfig, { recursive: true, force: true });
console.log(
  `dev-publish: done. Install with --registry ${registryUrl} or the .npmrc in README.md.`,
);
