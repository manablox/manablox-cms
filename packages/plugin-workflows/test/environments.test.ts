import { randomUUID } from 'node:crypto';
import type { SpaceEnvironmentRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { EnvironmentLifecycleService } from '@manablox/services';
import { createServiceContext, type ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';

let ctx: ServiceContext;
let environments: EnvironmentLifecycleService;
let counter = 0;

const MANUAL: WorkflowTrigger = { kind: 'manual', parameters: [] };

beforeAll(async () => {
  ctx = await createServiceContext('workflow_environments', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [] }],
    config: { plugins: [workflowsPlugin()] },
  });
  environments = new EnvironmentLifecycleService(ctx.manablox, ctx.repos, {
    contentTypes: ctx.contentTypes,
    promotes: ctx.controlStore.promotes,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const store = () => workflowRepos(ctx.repos).workflows;

const workflowsOf = (environment: Pick<SpaceEnvironmentRow, 'id'>) =>
  store().listByEnvironment(environment.id);

const versionsOf = async (workflowId: string) =>
  (await store().listVersionsOf([workflowId])).sort((a, b) => a.version - b.version);

/** A space with a switched-on, published workflow in production. */
async function freshSpace() {
  const machineName = `wf-env-${++counter}-${randomUUID().slice(0, 6)}`;
  const space = await ctx.spaces.create(
    { name: machineName, machineName, url: 'http://env.test' },
    null,
  );
  const spaceId = space.id;
  const production = await ctx.repos.environments.production(spaceId);
  if (!production) throw new Error('no production');
  const workflow = await store().create({
    spaceId,
    name: 'Notify',
    enabled: true,
    trigger: MANUAL,
    nodes: [],
    edges: [],
  });
  await store().publish(workflow.id, {
    definition: {
      name: workflow.name,
      description: null,
      trigger: MANUAL,
      abortTriggers: [],
      nodes: [],
      edges: [],
    },
  });
  return { spaceId, production, workflow };
}

const staging = (spaceId: string) =>
  environments.create(spaceId, { machineName: 'staging', name: 'Staging', mode: 'config' });

describe('copying workflows into an environment', () => {
  it('copies them switched off with their versions under new ids', async () => {
    const seed = await freshSpace();
    const { environment, copied } = await staging(seed.spaceId);
    const [copy, ...rest] = await workflowsOf(environment);
    expect(rest).toEqual([]);
    expect(copy).toMatchObject({ name: 'Notify', enabled: false, publishedVersion: 1 });
    expect(copy?.id).not.toBe(seed.workflow.id);
    const [version] = await versionsOf(copy?.id as string);
    expect(version).toMatchObject({ workflowId: copy?.id, version: 1, name: 'Notify' });
    expect(version?.id).not.toBe((await versionsOf(seed.workflow.id))[0]?.id);
    expect(copied).toMatchObject({ workflows: 1 });
    // Production is untouched.
    expect((await workflowsOf(seed.production))[0]?.enabled).toBe(true);
  });
});

describe('workflows of an environment', () => {
  it('keeps staging workflows out of the space lists and the live index', async () => {
    const seed = await freshSpace();
    const { environment } = await staging(seed.spaceId);
    const [copy] = await workflowsOf(environment);
    await store().updateRow(copy?.id as string, { enabled: true });
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

    expect(ids(await store().listBySpace(seed.spaceId))).toEqual([seed.workflow.id]);
    expect(ids(await store().listLive({ spaceId: seed.spaceId }))).toEqual([seed.workflow.id]);
    expect(ids(await store().listLive())).not.toContain(copy?.id);
    expect(
      ids(await store().listLive({ spaceId: seed.spaceId, environmentId: environment.id })),
    ).toEqual([copy?.id]);
  });
});

describe('promoting workflows', () => {
  it('moves the draft back under the production id and shows it in the diff', async () => {
    const seed = await freshSpace();
    const { environment } = await staging(seed.spaceId);
    const [copy] = await workflowsOf(environment);
    await store().updateRow(copy?.id as string, { name: 'Notify all', enabled: true });

    const diff = await environments.diff(seed.spaceId, 'staging', 'config');
    expect(diff.changes.find((entry) => entry.kind === 'workflows')).toMatchObject({ changed: 1 });
    const result = await environments.promote(seed.spaceId, 'staging', 'config');
    expect(result.groups.map((group) => group.group).at(-1)).toBe('workflows');

    const [live] = await workflowsOf(seed.production);
    expect(live).toMatchObject({ id: seed.workflow.id, name: 'Notify all', enabled: true });
    // The published definition did not change, so no version is added.
    expect((await versionsOf(seed.workflow.id)).map((row) => row.version)).toEqual([1]);
  });

  it('publishes a changed published definition as a new production version', async () => {
    const seed = await freshSpace();
    const { environment } = await staging(seed.spaceId);
    const [copy] = await workflowsOf(environment);
    await store().publish(copy?.id as string, {
      definition: {
        name: 'Notify more',
        description: null,
        trigger: MANUAL,
        abortTriggers: [],
        nodes: [],
        edges: [],
      },
    });
    await environments.promote(seed.spaceId, 'staging', 'config');
    const [live] = await workflowsOf(seed.production);
    expect(live?.publishedVersion).toBe(2);
    expect((await versionsOf(seed.workflow.id)).at(-1)).toMatchObject({
      version: 2,
      name: 'Notify more',
      note: 'Promoted from staging',
    });
  });

  it('keeps production switched off where it was', async () => {
    const seed = await freshSpace();
    await store().update(seed.workflow.id, { enabled: false });
    const { environment } = await staging(seed.spaceId);
    const [copy] = await workflowsOf(environment);
    await store().updateRow(copy?.id as string, { enabled: true });
    await environments.promote(seed.spaceId, 'staging', 'config');
    expect((await workflowsOf(seed.production))[0]?.enabled).toBe(false);
  });

  it('adds new workflows switched off and removes deleted ones; code workflows stay', async () => {
    const seed = await freshSpace();
    const code = await store().create({
      spaceId: seed.spaceId,
      name: 'From code',
      slug: 'from-code',
      source: 'code',
      enabled: true,
      trigger: MANUAL,
      nodes: [],
      edges: [],
    });
    const { environment } = await staging(seed.spaceId);
    const copies = await workflowsOf(environment);
    await store().removeRows(copies.filter((row) => row.name === 'Notify').map((row) => row.id));
    await store().updateRow(copies.find((row) => row.name === 'From code')?.id as string, {
      name: 'Edited in staging',
    });
    await store().create({
      spaceId: seed.spaceId,
      environmentId: environment.id,
      name: 'Fresh',
      enabled: true,
      trigger: MANUAL,
      nodes: [],
      edges: [],
    });

    const diff = await environments.diff(seed.spaceId, 'staging', 'config');
    expect(diff.changes.find((entry) => entry.kind === 'workflows')).toMatchObject({
      added: 1,
      changed: 0,
      removed: 1,
    });
    await environments.promote(seed.spaceId, 'staging', 'config');
    const live = await workflowsOf(seed.production);
    expect(live.map((row) => [row.name, row.enabled]).sort()).toEqual([
      ['Fresh', false],
      ['From code', true],
    ]);
    expect(live.find((row) => row.name === 'From code')?.id).toBe(code.id);
  });
});
