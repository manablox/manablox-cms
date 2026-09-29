import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addCommand,
  detectPackageManager,
  installCommand,
  removeCommand,
} from '../src/package-manager.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-package-manager-');

describe('package manager detection', () => {
  it('reads the lockfile, then the packageManager field, then the running tool', () => {
    const dir = tempDir();
    const none = {};
    expect(detectPackageManager(dir, none)).toBe('pnpm');
    expect(
      detectPackageManager(dir, { npm_config_user_agent: 'npm/10.9.0 node/v24.0.0 linux x64' }),
    ).toBe('npm');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.5.0' }));
    expect(detectPackageManager(dir, { npm_config_user_agent: 'npm/10.9.0' })).toBe('yarn');
    writeFileSync(join(dir, 'bun.lock'), '');
    expect(detectPackageManager(dir, none)).toBe('bun');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir, none)).toBe('npm');
    const pnpm = join(dir, 'pnpm');
    mkdirSync(pnpm);
    writeFileSync(join(pnpm, 'pnpm-lock.yaml'), '');
    writeFileSync(join(pnpm, 'package.json'), JSON.stringify({ packageManager: 'npm@10.0.0' }));
    expect(detectPackageManager(pnpm, none)).toBe('pnpm');
    // An unknown tool says nothing.
    expect(detectPackageManager(tempDir(), { npm_config_user_agent: 'deno/2.0' })).toBe('pnpm');
  });

  it('installs so that a changed package.json updates the lockfile, even with CI=true', () => {
    expect(installCommand('pnpm')).toEqual(['pnpm', ['install', '--no-frozen-lockfile'], {}]);
    expect(installCommand('yarn')).toEqual([
      'yarn',
      ['install'],
      { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
    ]);
    expect(installCommand('npm')).toEqual(['npm', ['install'], {}]);
    expect(addCommand('npm', ['acme@1'])).toEqual(['npm', ['install', 'acme@1']]);
    expect(addCommand('bun', ['acme'])).toEqual(['bun', ['add', 'acme']]);
    expect(removeCommand('pnpm', ['acme'])).toEqual(['pnpm', ['remove', 'acme']]);
    expect(removeCommand('npm', ['acme'])).toEqual(['npm', ['uninstall', 'acme']]);
  });
});
