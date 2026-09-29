import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { bootstrap, type ManagementRuntime, requireManagement } from '@manablox/server';
import type { SpaceExport } from '@manablox/services';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_TRIGGER_ID, type WorkflowEdge, type WorkflowNode } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';
import type { ExportedWorkflowEntry } from '../src/server/transfer/index.js';

/** Space export and import of workflows through the `workflows.workflows` section. */
let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let spaceId: string;
let ownerId: string;
let nudgeId: string;
let targetId: string;
let seq = 0;

const SECTION = 'workflows.workflows';

const node = (key: string, extra: Record<string, unknown>): WorkflowNode =>
  ({
    id: `node-${key}`,
    key,
    name: '',
    enabled: true,
    continueOnError: false,
    join: 'any',
    ui: { x: 0, y: 150 },
    ...extra,
  }) as WorkflowNode;

const fromTrigger = (to: string): WorkflowEdge => ({
  id: `edge-${to}`,
  from: WORKFLOW_TRIGGER_ID,
  fromPort: 'out',
  to: `node-${to}`,
  guard: null,
});

/** The section's entries of an export. */
const entriesOf = (payload: SpaceExport) =>
  (payload.plugins?.[SECTION] ?? []) as ExportedWorkflowEntry[];

/** The export under a new space identity and fresh workflow ids, for the same instance. */
function asCopy(payload: SpaceExport): SpaceExport {
  let json = JSON.stringify(payload);
  for (const entry of entriesOf(payload)) json = json.replaceAll(entry.id, crypto.randomUUID());
  const copy = JSON.parse(json) as SpaceExport;
  const name = `copy-${++seq}`;
  copy.space = { ...copy.space, id: crypto.randomUUID(), machineName: name, name };
  return copy;
}

beforeAll(async () => {
  const plugin = workflowsPlugin();
  db = await createTestDatabase('workflows_transfer_section', { plugins: [plugin] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-workflows-'));
  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'workflows-plugin-secret-0123456789' },
      fieldTypes: [],
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') }, maxFileSize: 10_000_000 },
      server: { rateLimit: false, scopes: ['rpc'] },
      plugins: [plugin],
    }),
  );

  const space = await api.repos.spaces.create({
    name: 'Source',
    machineName: 'source',
    url: 'https://source.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
  const owner = await api.repos.users.create({
    name: 'Importer',
    email: 'importer@workflows.test',
    role: 'editor',
    passwordHash: 'x',
  });
  ownerId = owner.id;

  const workflows = workflowRepos(api.repos).workflows;
  const nudge = await workflows.create({
    spaceId,
    name: 'Nudge',
    trigger: { kind: 'event', events: ['content.published'], typeIds: [], locales: [] },
    nodes: [node('pause', { kind: 'delay', minutes: 5 })],
    edges: [fromTrigger('pause')],
  });
  nudgeId = nudge.id;
  const target = await workflows.create({
    spaceId,
    name: 'Send order',
    slug: 'send-order',
    trigger: { kind: 'call', parameters: [], output: '' },
    nodes: [node('wait', { kind: 'delay', minutes: 1 })],
    edges: [fromTrigger('wait')],
  });
  targetId = target.id;
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('workflows in a space transfer', () => {
  it('exports them as the plugin section, never at the top level', async () => {
    const payload = await api.spaces.export(spaceId);

    expect(payload.sections).toContain(SECTION);
    expect(payload).not.toHaveProperty('workflows');
    expect(payload).not.toHaveProperty('calledWorkflows');
    expect(entriesOf(payload).find((entry) => entry.id === nudgeId)).toMatchObject({
      name: 'Nudge',
      enabled: false,
      published: false,
    });
    const inventory = await api.spaces.inventory(spaceId);
    expect(inventory.plugins[SECTION]).toBe(2);
  });

  it('lists them for picking one by one and exports only the picked ones', async () => {
    const inventory = await api.spaces.inventory(spaceId);
    expect(inventory.pluginEntries[SECTION]).toEqual(
      expect.arrayContaining([
        { id: nudgeId, label: 'Nudge' },
        { id: targetId, label: 'Send order' },
      ]),
    );
    const payload = await api.spaces.export(spaceId, { ids: { [SECTION]: [targetId] } });
    expect(entriesOf(payload).map((entry) => entry.id)).toEqual([targetId]);
  });

  it('leaves them out when the section is not asked for', async () => {
    const payload = await api.spaces.export(spaceId, { sections: ['roles'] });
    expect(payload.plugins?.[SECTION]).toBeUndefined();
  });

  it('imports them into the new space, and tells the engine once the import is finished', async () => {
    const forget = vi.spyOn(api.manablox.plugins.require('workflows').engine, 'forgetLive');
    try {
      const copy = asCopy(await api.spaces.export(spaceId));
      const result = await api.spaces.import(copy, ownerId);

      expect(result.plugins).toEqual({ [SECTION]: 2 });
      const rows = await workflowRepos(api.repos).workflows.listBySpace(result.spaceId);
      expect(rows.map((row) => row.name).sort()).toEqual(['Nudge', 'Send order']);
      expect(rows.every((row) => !row.enabled)).toBe(true);
      await vi.waitFor(() => expect(forget).toHaveBeenCalledWith(result.spaceId));
    } finally {
      forget.mockRestore();
    }
  });

  it('tells the engine after an import without workflows, too', async () => {
    const forget = vi.spyOn(api.manablox.plugins.require('workflows').engine, 'forgetLive');
    try {
      const copy = asCopy(await api.spaces.export(spaceId, { sections: ['roles'] }));
      const result = await api.spaces.import(copy, ownerId);
      await vi.waitFor(() => expect(forget).toHaveBeenCalledWith(result.spaceId));
    } finally {
      forget.mockRestore();
    }
  });
});
