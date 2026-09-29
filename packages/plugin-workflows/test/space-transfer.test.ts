import { ManabloxError } from '@manablox/core';
import type { SpaceExport } from '@manablox/services';
import { type ServiceContext, withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../src/sdk.js';
import { workflowsData } from '../src/server/data.js';
import { workflowRepos } from '../src/server/db/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import {
  type ExportedWorkflow,
  type ExportedWorkflowEntry,
  isExportedWorkflow,
} from '../src/server/transfer/index.js';
import { action, call, called, chain, delay } from './helpers/graph.js';
import { createWorkflowHarness } from './helpers/harness.js';

let ctx: ServiceContext;
let service: WorkflowService;
let ownerId: string;
const ids: Record<string, string> = {};

const http = (key: string, credentialId: string) =>
  action(key, 'http', { url: 'https://crm.test/orders' }, { credentialId });
const callWith = (key: string, workflowId: string) =>
  call(key, workflowId, { order: '{{ trigger.body.id }}' });
const pause = (key: string) => delay(key, 5);
const callTrigger = called([{ name: 'order', required: true }]);

/** The plugin's section of a space export. */
const SECTION = workflowsData.kind;

/** The section's entries: workflows and the call targets outside them. */
const entriesOf = (payload: SpaceExport) =>
  (payload.plugins?.[SECTION] ?? []) as ExportedWorkflowEntry[];
const workflowsOf = (payload: SpaceExport): ExportedWorkflow[] =>
  entriesOf(payload).filter(isExportedWorkflow);

/** The export under fresh ids for every row, so it imports into the same instance. */
function asCopy(payload: SpaceExport, machineName: string): SpaceExport {
  const rows = [payload.space, ...entriesOf(payload), ...(payload.credentials ?? [])];
  let json = JSON.stringify(payload);
  for (const row of rows) json = json.replaceAll(row.id, crypto.randomUUID());
  const copy = JSON.parse(json) as SpaceExport;
  copy.space.machineName = machineName;
  return copy;
}

const exportFlows = () => ctx.spaces.export(ctx.spaceId, { sections: [SECTION, 'credentials'] });

/** A copy holding only the workflows `keep` picks, and none of the call targets. */
function onlyWorkflows(copy: SpaceExport, keep: (row: ExportedWorkflow) => boolean): SpaceExport {
  return { ...copy, plugins: { ...copy.plugins, [SECTION]: workflowsOf(copy).filter(keep) } };
}

beforeAll(async () => {
  const h = await createWorkflowHarness('workflow-space-transfer', {
    config: {},
    engine: { now: () => new Date() },
    listen: false,
  });
  ({ ctx, service } = h);
  const { credentials } = h;
  const { repos } = ctx;

  const crm = await credentials.create(ctx.spaceId, {
    name: 'CRM',
    kind: 'bearer',
    data: { token: 'crm-secret' },
  });
  const child = await service.create(
    ctx.spaceId,
    { name: 'Sync order', trigger: callTrigger, ...chain(http('push', crm.id)), enabled: true },
    { publish: true },
  );
  const parent = await service.create(
    ctx.spaceId,
    {
      name: 'Receive order',
      trigger: { kind: 'manual', parameters: [] },
      ...chain(callWith('sync', child.id)),
      enabled: true,
    },
    { publish: true },
  );
  // The draft moves on past what is live.
  await service.update(ctx.spaceId, parent.id, {
    name: 'Receive order',
    trigger: parent.trigger,
    ...chain(pause('settle'), callWith('sync', child.id)),
    enabled: true,
  });
  await service.create(ctx.spaceId, {
    name: 'Idea',
    trigger: { kind: 'event', events: ['content.created'], typeIds: [], locales: [] },
    ...chain(pause('wait')),
  });
  Object.assign(ids, { crm: crm.id, child: child.id, parent: parent.id });

  const owner = await repos.users.create({
    name: 'Importer',
    email: 'importer@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
  ownerId = owner.id;
});

afterAll(async () => {
  await ctx?.close();
});

describe('space transfer of workflows', () => {
  it('exports the live definition beside a draft that moved on', async () => {
    const payload = await exportFlows();
    const parent = workflowsOf(payload).find((row) => row.id === ids.parent);
    expect(parent?.published).toBe(true);
    expect(parent?.nodes.map((node) => node.key)).toEqual(['settle', 'sync']);
    expect(parent?.live?.nodes.map((node) => node.key)).toEqual(['sync']);
    expect(workflowsOf(payload).find((row) => row.id === ids.child)?.live).toBeUndefined();
  });

  it('imports validated, audited workflows wired to the imported credentials', async () => {
    const copy = asCopy(await exportFlows(), 'wired');
    const result = await ctx.spaces.import(copy, ownerId);
    expect(result).toMatchObject({ credentials: 1, notes: [] });
    expect(result.plugins).toMatchObject({ [SECTION]: 3 });
    const spaceId = result.spaceId;

    const credentials = await ctx.repos.credentials.listBySpace(spaceId);
    const crm = credentials.find((row) => row.slug === 'crm');
    const rows = await workflowRepos(ctx.repos).workflows.listBySpace(spaceId);
    const byName = (name: string) => rows.find((row) => row.name === name);
    const parent = byName('Receive order');
    const child = byName('Sync order');

    // Ids are kept, so the call node points at the imported child.
    expect(parent?.id).toBe(workflowsOf(copy).find((row) => row.name === 'Receive order')?.id);
    expect(parent?.nodes.find((node) => node.key === 'sync')).toMatchObject({
      workflowId: child?.id,
    });
    expect(child?.nodes[0]).toMatchObject({ credentialId: crm?.id });

    // The live definition is version 1; the draft stays ahead of it.
    expect(parent).toMatchObject({ publishedVersion: 1, draftChanged: true, enabled: true });
    expect(parent?.nodes.map((node) => node.key)).toEqual(['settle', 'sync']);
    const live = await workflowRepos(ctx.repos).workflows.findVersion(parent?.id as string, 1);
    expect(live?.nodes.map((node) => node.key)).toEqual(['sync']);
    expect(live?.note).toBe('Imported with the space');
    expect(child).toMatchObject({ publishedVersion: 1, draftChanged: false });
    expect(byName('Idea')?.publishedVersion).toBeNull();

    const audit = await ctx.repos.audit.page(
      { spaceId, actions: ['workflows.workflow.import', 'workflows.workflow.publish'] },
      { by: 'at', direction: 'asc' },
    );
    const entries = audit.items.map((row) => [row.action, row.targetLabel]);
    expect(entries.filter(([action]) => action === 'workflows.workflow.import')).toHaveLength(3);
    expect(entries.filter(([action]) => action === 'workflows.workflow.publish')).toHaveLength(2);
    expect(audit.items[0]?.meta).toMatchObject({ via: 'space.import' });

    // The space's own credential section is audited like the workflows'.
    const sections = await ctx.repos.audit.page({
      spaceId,
      actions: ['credential.create'],
    });
    expect(sections.items.map((row) => row.meta)).toEqual([
      { kind: crm?.kind, provider: crm?.provider, via: 'space.import' },
    ]);
  });

  it('recreates the credentials the workflows use when they stay behind', async () => {
    const copy = asCopy(await exportFlows(), 'workflows-only');
    const result = await ctx.spaces.import(copy, ownerId, { sections: [SECTION] });
    expect(result).toMatchObject({ credentials: 0 });
    expect(result.plugins).toMatchObject({ [SECTION]: 3 });
    expect(result.notes).toEqual(['Created the credential "CRM"; fill in its secret.']);

    const [credential] = await ctx.repos.credentials.listBySpace(result.spaceId);
    expect(credential).toMatchObject({ slug: 'crm' });
    const child = (await workflowRepos(ctx.repos).workflows.listBySpace(result.spaceId)).find(
      (row) => row.name === 'Sync order',
    );
    expect(child?.nodes[0]).toMatchObject({ key: 'push', credentialId: credential?.id });
    const created = await ctx.repos.audit.page({
      spaceId: result.spaceId,
      actions: ['credential.create'],
    });
    expect(created.items.map((row) => row.meta)).toEqual([
      expect.objectContaining({ via: 'space.import' }),
    ]);
  });

  it('stops at an invalid workflow, keeping the space failed with the reason', async () => {
    const copy = asCopy(await exportFlows(), 'invalid');
    const child = workflowsOf(copy).find((row) => row.name === 'Sync order');
    if (child) child.nodes = [{ ...(child.nodes[0] as WorkflowNode), action: 'nope' } as never];

    const error = await ctx.spaces.import(copy, ownerId).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ key: 'space.import.failed', kind: 'validation' });
    expect((error as { details: Array<{ key: string }> }).details.map((d) => d.key)).toContain(
      'space.import.failed',
    );
    expect(await ctx.repos.spaces.findById(copy.space.id)).toMatchObject({
      importStatus: 'failed',
      importProgress: { step: SECTION, error: { key: 'plugins.workflows.validation.failed' } },
    });
    // Nothing of the step that failed was written.
    expect(await workflowRepos(ctx.repos).workflows.listBySpace(copy.space.id)).toEqual([]);
    await ctx.spaces.delete(copy.space.id);
    expect(await ctx.repos.spaces.findById(copy.space.id)).toBeNull();
  });

  it('imports a workflow whose called workflow is missing switched off, and the rest as usual', async () => {
    // The file leaves the one it runs out.
    const copy = onlyWorkflows(
      asCopy(await exportFlows(), 'missing-target'),
      (row) => row.name !== 'Sync order',
    );
    const result = await ctx.spaces.import(copy, ownerId);
    expect(result.plugins).toMatchObject({ [SECTION]: 2 });
    expect(result.notes).toContain(
      'Imported "Receive order" switched off and unpublished: a workflow it runs is not in this space.',
    );

    const rows = await workflowRepos(ctx.repos).workflows.listBySpace(result.spaceId);
    const parent = rows.find((row) => row.name === 'Receive order');
    expect(parent).toMatchObject({ enabled: false, publishedVersion: null });
    expect(parent?.nodes.find((node) => node.key === 'sync')).toMatchObject({ workflowId: null });
  });

  it('runs workflows:beforeEnable once per enabled workflow before writing; a refusal leaves no space', async () => {
    const seen: string[] = [];
    const off = ctx.manablox.hooks.on('workflows:beforeEnable', (payload) => {
      seen.push(payload.name);
    });
    try {
      const result = await ctx.spaces.import(asCopy(await exportFlows(), 'hooked'), ownerId);
      expect(result.plugins).toMatchObject({ [SECTION]: 3 });
    } finally {
      off();
    }
    expect(seen.sort()).toEqual(['Receive order', 'Sync order']);

    const copy = asCopy(await exportFlows(), 'refused-flows');
    const refuse = ctx.manablox.hooks.on('workflows:beforeEnable', () => {
      throw ManabloxError.forbidden('auth.forbidden');
    });
    try {
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        key: 'auth.forbidden',
      });
    } finally {
      refuse();
    }
    expect(await ctx.repos.spaces.findById(copy.space.id)).toBeNull();
  });

  it('refuses workflows while `plugins.workflows` is off, before and inside the import', async () => {
    const restore = await withControls(ctx, { features: { 'plugins.workflows': false } });
    try {
      const copy = asCopy(await exportFlows(), 'flows-off');
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        key: 'control.feature',
      });
      expect(await ctx.repos.spaces.findById(copy.space.id)).toBeNull();
      await expect(
        ctx.repos.transaction((tx) => service.importSpace(tx, ctx.spaceId, entriesOf(copy))),
      ).rejects.toMatchObject({ key: 'control.feature' });
    } finally {
      await restore();
    }
  });
});
