import { serve } from '@hono/node-server';
import { type ManabloxConfig, ManabloxError, type ServerMode } from '@manablox/core';
import type { Hono } from 'hono';
import { type CreateAppOptions, createApp } from './app.js';
import { bootstrap, type Runtime } from './bootstrap.js';

export interface RunOptions extends Omit<CreateAppOptions, 'mode'> {
  /** Overrides `server.mode`: `management`, `public` or a plugin's mode. */
  mode?: ServerMode;
  /** Names the process in logs and errors; from the mode by default. */
  label?: string;
}

/** Boots, builds the app and listens. Config errors print as a table and exit before binding. */
export async function run(config: ManabloxConfig, options: RunOptions = {}): Promise<void> {
  const { mode, label: named, ...appOptions } = options;
  const resolved = mode ? { ...config, server: { ...config.server, mode } } : config;
  const label = named ?? processLabel(resolved.server?.mode);
  let runtime: Runtime;
  try {
    runtime = await bootstrap(resolved);
  } catch (error) {
    if (ManabloxError.is(error) && error.key === 'config.invalid') {
      console.error(`${label}: the configuration is invalid`);
      for (const detail of error.details) {
        const where = (detail.path ?? []).join('.');
        const params = detail.params ? ` ${JSON.stringify(detail.params)}` : '';
        console.error(`  ${where.padEnd(28)} ${detail.key}${params}`);
      }
      process.exit(1);
    }
    throw error;
  }
  startServer(runtime, await createApp(runtime, appOptions), label);
}

function processLabel(mode: ServerMode | undefined): string {
  if (!mode || mode === 'management') return 'manablox';
  return mode === 'public' ? 'manablox public api' : `manablox ${mode}`;
}

/** Listens, and on SIGTERM/SIGINT drains in-flight requests before shutting down. */
export function startServer(runtime: Runtime, app: Hono, label: string): void {
  const { host, port, mode, scopes } = runtime.manablox.config.server;
  const server = serve({ fetch: app.fetch, hostname: host, port });

  runtime.manablox.logger.info(
    { url: `http://${host}:${port}`, mode, scopes },
    `${label} listening`,
  );

  const shutdown = async (signal: string) => {
    runtime.manablox.logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await runtime.shutdown();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
