import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '@manablox/services/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkflowDesigner } from '../src/server/services/workflow/catalog.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { action, chain } from './helpers/graph.js';
import { createWorkflowHarness } from './helpers/harness.js';

/** Each space lookup a request makes reads its table once, however many workflows exist. */
const WORKFLOWS = 12;

let ctx: ServiceContext;
let service: WorkflowService;
let exportedId: string;

const graph = (credentialId: string | null) =>
  chain(
    action(
      'fetch',
      'http',
      { url: 'https://x.test', method: 'GET', headers: {}, body: '' },
      { credentialId },
    ),
  );

/** Reads of the lookup tables, keyed by table. */
function lookupReads(): Record<string, number> {
  const out: Record<string, number> = { credentials: 0, workflows: 0 };
  for (const query of ctx.queries()) {
    if (!/^\s*select/i.test(query)) continue;
    for (const table of Object.keys(out)) {
      if (new RegExp(`from "${table}"`).test(query)) out[table] = (out[table] ?? 0) + 1;
    }
  }
  return out;
}

beforeAll(async () => {
  const h = await createWorkflowHarness('workflow_lookups', {
    engine: { now: () => new Date() },
    listen: false,
  });
  ({ ctx, service } = h);
  const { credentials } = h;

  const credential = await credentials.create(ctx.spaceId, {
    name: 'Stripe',
    kind: 'apiKey',
    data: { header: 'X-Api-Key', key: 'sk-1' },
  });
  for (let index = 0; index < WORKFLOWS; index++) {
    const row = await service.create(ctx.spaceId, {
      name: `Flow ${index}`,
      trigger:
        index % 2
          ? { kind: 'call', parameters: [], output: '' }
          : { kind: 'event', events: ['content.created'], typeIds: [], locales: [] },
      ...graph(credential.id),
      enabled: true,
    });
    exportedId = row.id;
  }
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

/** Hands `ai` out as the design service of the plugin that designs, as the plugin lookup does. */
function withDesigner(ai: WorkflowDesigner): void {
  vi.spyOn(ctx.manablox.plugins, 'get').mockReturnValue({ design: ai });
  vi.spyOn(ctx.manablox.plugins, 'isOn').mockResolvedValue(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('space lookups', () => {
  it('reads each table once for the catalog', async () => {
    ctx.resetQueryCount();
    const catalog = await service.catalog(ctx.spaceId);
    expect(catalog.callable.length).toBe(WORKFLOWS / 2);
    expect(lookupReads()).toEqual({ credentials: 1, workflows: 1 });
  });

  it('reads each table once to design, for the catalog and the validator together', async () => {
    const stop = new Error('stop');
    withDesigner({
      design: async () => {
        throw stop;
      },
    });
    ctx.resetQueryCount();
    await expect(service.design({ spaceId: ctx.spaceId, prompt: 'x' })).rejects.toBe(stop);
    expect(lookupReads()).toEqual({ credentials: 1, workflows: 1 });
  });

  it('refuses to design while no plugin designs', async () => {
    await expect(service.design({ spaceId: ctx.spaceId, prompt: 'x' })).rejects.toMatchObject({
      key: 'plugins.workflows.design.unavailable',
    });
  });

  it("designs with the environment's types", async () => {
    const staging = await ctx.repos.environments.create({
      id: randomUUID(),
      spaceId: ctx.spaceId,
      machineName: 'design-staging',
      name: 'Design staging',
      kind: 'staging',
      createdFrom: null,
      createdMode: 'config',
    });
    await ctx.contentTypes.create({
      name: 'stagedonly',
      spaceId: ctx.spaceId,
      environmentId: staging.id,
      fields: [],
    });
    const prompts: string[] = [];
    withDesigner({
      design: async (request) => {
        prompts.push(request.prompt);
        throw new Error('stop');
      },
    });
    const scope = {
      spaceId: ctx.spaceId,
      environmentId: staging.id,
      machineName: staging.machineName,
      production: false,
    };
    await expect(service.design({ spaceId: ctx.spaceId, scope, prompt: 'x' })).rejects.toThrow(
      'stop',
    );
    await expect(service.design({ spaceId: ctx.spaceId, prompt: 'x' })).rejects.toThrow('stop');
    expect(prompts[0]).toContain('stagedonly');
    expect(prompts[1]).not.toContain('stagedonly');
    await ctx.repos.environments.delete(staging.id);
    await ctx.contentTypes.reload();
  });

  it('reads each table once to export, beside the workflow itself', async () => {
    ctx.resetQueryCount();
    const file = await service.export(ctx.spaceId, exportedId);
    expect(file.credentials).toHaveLength(1);
    expect(lookupReads()).toEqual({ credentials: 1, workflows: 2 });
  });

  it('reads each table once to import', async () => {
    const file = await service.export(ctx.spaceId, exportedId);
    ctx.resetQueryCount();
    const { workflow } = await service.import(ctx.spaceId, file);
    expect(workflow.name).not.toBe(`Flow ${WORKFLOWS - 1}`);
    expect(lookupReads()).toEqual({ credentials: 1, workflows: 1 });
  });
});
