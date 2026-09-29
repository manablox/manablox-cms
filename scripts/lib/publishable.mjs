// Lists publishable packages as `<dir> <name> <version> <src|dist>` for `scripts/publish.sh`.
// A file, not `node -e`, because multi-line code does not survive `sh -c` quoting.
// Imported, it exports the manifest walk for other scripts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Every workspace package as `{ dir, pkg }`, `dir` relative to the repository root. */
export function workspacePackages() {
  const found = [];
  // `apps` holds the prebuilt admin package.
  for (const root of ['packages', 'apps']) {
    for (const name of readdirSync(join(repoRoot, root)).sort()) {
      const dir = `${root}/${name}`;
      const file = join(repoRoot, dir, 'package.json');
      if (!existsSync(file)) continue;
      found.push({ dir, pkg: JSON.parse(readFileSync(file, 'utf8')) });
    }
  }
  return found;
}

/**
 * The `/testing` subpaths that are published: the premium plugins' repositories run their
 * tests with them. Every other `/testing` export stays workspace-only.
 */
const PUBLISHED_TESTING = new Set([
  '@manablox/admin-sdk/testing',
  '@manablox/core/testing',
  '@manablox/db/testing',
  '@manablox/plugin-license/testing',
  '@manablox/services/testing',
]);

/** The packages `pnpm publish` sends to npm. */
function publishablePackages() {
  return workspacePackages().filter(({ pkg }) => !pkg.private);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { dir, pkg } of publishablePackages()) {
    // `publishConfig` wins, as pnpm writes it into the tarball. No entry point means files only.
    const published = pkg.publishConfig ?? {};
    // Only the test helpers other repositories' tests import are published.
    const leaked = Object.keys(published.exports ?? {})
      .filter((key) => key.endsWith('/testing'))
      .filter((key) => !PUBLISHED_TESTING.has(`${pkg.name}${key.slice(1)}`));
    if (leaked.length > 0) {
      console.error(
        `${pkg.name}: publishConfig exports ${leaked.join(', ')}, which is not in PUBLISHED_TESTING`,
      );
      process.exit(1);
    }
    const entry =
      published.exports?.['.']?.default ??
      published.exports?.['.']?.import ??
      published.main ??
      pkg.exports?.['.']?.default ??
      pkg.main ??
      '';
    console.log([dir, pkg.name, pkg.version, entry.includes('/src/') ? 'src' : 'dist'].join(' '));
  }
}
