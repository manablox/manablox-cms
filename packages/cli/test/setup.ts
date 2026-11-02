// The CLI does not depend on the website and AI plugins: `create` installs them from npm. Their
// stand-ins under `fixtures/packages/` are linked into a plugin cache of the CLI's version, where
// `firstPartyPlugins` finds them by package name as it finds the published ones. The workflows
// and webhooks plugins are the CLI's optional peers and resolve beside it.
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginCacheDir } from '../src/plugins.js';
import { readCliVersion } from '../src/version.js';

process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'manablox-cli-cache-'));
const scope = join(pluginCacheDir(readCliVersion()), 'node_modules', '@manablox');
mkdirSync(scope, { recursive: true });
for (const name of ['plugin-website', 'plugin-ai']) {
  symlinkSync(join(import.meta.dirname, 'fixtures/packages', name), join(scope, name), 'dir');
}
