import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManabloxConfig, ManabloxPlugin } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { bootstrap, createApp, type ManagementRuntime, requireManagement } from '@manablox/server';
import type { Hono } from 'hono';
import { webhooksPlugin } from '../../src/server/plugin.js';
import type { WebhooksServices } from '../../src/server/services/index.js';

export interface WebhookServer {
  db: TestDatabase;
  api: ManagementRuntime;
  app: Hono;
  /** The plugin's services on the booted instance. */
  services: () => WebhooksServices;
  /** A fresh space's id. */
  space: () => Promise<string>;
  /** A call to an incoming endpoint's path, as another system makes it. */
  call: (path: string, init?: RequestInit & { ip?: string }) => Promise<Response>;
  close: () => Promise<void>;
}

let seq = 0;

/**
 * A management instance with the webhooks plugin and `plugins` before it (e.g. workflows), on a
 * test database of its own, and its HTTP app.
 */
export async function bootWebhookServer(
  name: string,
  options: { plugins?: ManabloxPlugin[]; config?: Partial<ManabloxConfig> } = {},
): Promise<WebhookServer> {
  const plugins = [...(options.plugins ?? []), webhooksPlugin()];
  const db = await createTestDatabase(name, { plugins });
  const dir = await mkdtemp(join(tmpdir(), 'manablox-webhooks-'));
  const api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'webhooks-plugin-secret-0123456789' },
      fieldTypes: [],
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth'], publicUrl: 'https://api.hooks.test' },
      plugins,
      ...options.config,
    }),
  );
  const app = await createApp(api);
  return {
    db,
    api,
    app,
    services: () => api.manablox.plugins.require('webhooks'),
    space: async () => {
      const machineName = `${name}_${++seq}`;
      const space = await api.repos.spaces.create({
        name: machineName,
        machineName,
        url: `https://${machineName}.test`,
        defaultLocale: 'en',
        locales: ['en'],
      });
      return space.id;
    },
    call: async (path, { ip, headers, ...init } = {}) =>
      app.request(
        new Request(`https://api.hooks.test${path}`, {
          method: 'POST',
          body: '{}',
          ...init,
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip ?? '198.51.100.7',
            ...(headers as Record<string, string> | undefined),
          },
        }),
      ),
    close: async () => {
      await api.shutdown();
      await db.drop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
