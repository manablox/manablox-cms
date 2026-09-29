import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManabloxConfig, Scope } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, type ManagementRuntime, requireManagement } from '@manablox/server';
import { WORKFLOW_TRIGGER_ID, type WorkflowGraph, type WorkflowTrigger } from '../../src/sdk.js';
import type { WorkflowRow } from '../../src/server/db/index.js';
import { workflowsPlugin } from '../../src/server/plugin.js';
import type { WorkflowsServices } from '../../src/server/services/index.js';

export interface WorkflowServer {
  db: TestDatabase;
  api: ManagementRuntime;
  /** The plugin's services on the booted instance. */
  services: () => WorkflowsServices;
  /** A fresh space's id. */
  space: () => Promise<string>;
  /** A published, switched-on workflow with one `transform.json` step after the trigger. */
  workflow: (scope: Scope, name: string, trigger: WorkflowTrigger) => Promise<WorkflowRow>;
  close: () => Promise<void>;
}

let seq = 0;

/** One `transform.json` step after the trigger. */
export const shapeGraph = {
  nodes: [
    {
      id: 'n1',
      key: 'shape',
      name: '',
      enabled: true,
      continueOnError: false,
      join: 'any',
      ui: { x: 0, y: 0 },
      kind: 'action',
      action: 'transform.json',
      config: { template: '{}' },
      credentialId: null,
    },
  ],
  edges: [{ id: 'e1', from: WORKFLOW_TRIGGER_ID, fromPort: 'out', to: 'n1', guard: null }],
} as unknown as WorkflowGraph;

/** A management instance with the workflows plugin, on a test database of its own. */
export async function bootWorkflowServer(
  name: string,
  config: Partial<ManabloxConfig> = {},
): Promise<WorkflowServer> {
  const db = await createTestDatabase(name, { plugins: [workflowsPlugin()] });
  const dir = await mkdtemp(join(tmpdir(), 'manablox-workflows-'));
  const api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'workflows-plugin-secret-0123456789' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth'] },
      plugins: [workflowsPlugin()],
      ...config,
    }),
  );
  return {
    db,
    api,
    services: () => api.manablox.plugins.require('workflows'),
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
    workflow: (scope, workflowName, trigger) =>
      api.manablox.plugins.require('workflows').workflows.create(
        scope,
        {
          name: workflowName,
          enabled: true,
          trigger,
          ...shapeGraph,
        },
        { publish: true },
      ),
    close: async () => {
      await api.shutdown();
      await db.drop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
