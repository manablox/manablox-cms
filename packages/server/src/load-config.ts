import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ManabloxConfig } from '@manablox/core';

export const CONFIG_FILES = [
  'manablox.config.ts',
  'manablox.config.mts',
  'manablox.config.js',
  'manablox.config.mjs',
];

/** Imports `manablox.config.ts` (default or `config` export), loading a sibling `.env` first. */
export async function loadConfig(
  explicit: string | undefined,
  cwd = process.cwd(),
): Promise<{ config: ManabloxConfig; file: string }> {
  loadDotEnv(cwd);

  const file = explicit
    ? resolve(cwd, explicit)
    : CONFIG_FILES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));

  if (!file || !existsSync(file)) {
    throw new Error(
      explicit
        ? `config file not found: ${file}`
        : `no ${CONFIG_FILES[0]} in ${cwd}; create one or pass --config <file>`,
    );
  }

  const module = (await import(pathToFileURL(file).href)) as {
    default?: ManabloxConfig;
    config?: ManabloxConfig;
  };
  const config = module.default ?? module.config;
  if (!config || typeof config !== 'object') {
    throw new Error(`${file} must export a defineConfig() object as its default export`);
  }
  return { config, file };
}

function loadDotEnv(cwd: string): void {
  const file = resolve(cwd, '.env');
  if (!existsSync(file)) return;
  const before = { ...process.env };
  try {
    process.loadEnvFile(file);
  } catch (error) {
    // No logger exists before the config does.
    process.emitWarning(`${file} not loaded: ${(error as Error).message}`);
    return;
  }
  // Existing env vars win over the file.
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}
