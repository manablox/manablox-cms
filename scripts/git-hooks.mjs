#!/usr/bin/env node
// `prepare`: installs git hooks only when git exists (dev containers have none).
// Node rather than `command -v git` so it also works under cmd.exe.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const git = spawnSync('git', ['--version'], { stdio: 'ignore' });
if (git.error || git.status !== 0) {
  console.log('prepare: git is not on the path, so the hooks are left alone');
  process.exit(0);
}

// Resolved, not taken from PATH, so a missing binary fails loudly.
const require = createRequire(import.meta.url);
const cli = require.resolve('simple-git-hooks/cli.js');

const installed = spawnSync(process.execPath, [cli], { stdio: 'inherit' });
if (installed.error) {
  console.error(`prepare: could not run simple-git-hooks: ${installed.error.message}`);
  process.exit(1);
}
process.exit(installed.status ?? 1);
