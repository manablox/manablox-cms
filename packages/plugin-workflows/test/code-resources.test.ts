import { defineCredential, defineTemplate, ref, TEMPLATE_TYPE_NAME } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import {
  CodeResourceService,
  type ContentService,
  type CredentialService,
  codeTemplateId,
  type SyncChange,
} from '@manablox/services';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineWorkflow, WORKFLOW_RESOURCE_KIND } from '../src/define/workflow.js';
import { codeWorkflowId } from '../src/server/code-resources.js';
import { workflowRepos } from '../src/server/db/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { createWorkflowHarness } from './helpers/harness.js';

/** A filled slot, an empty one, and a workflow using the filled one. */
const stripe = defineCredential({
  slug: 'stripe',
  kind: 'apiKey',
  values: { header: 'X-Api-Key', key: 'sk-test-1234' },
});
const github = defineCredential({ slug: 'github', kind: 'signing' });
const notify = defineWorkflow({
  slug: 'notify-on-publish',
  name: 'Tell the team',
  enabled: true,
  trigger: { kind: 'event', events: ['content.published'], typeIds: [ref.contentType('page')] },
  steps: [
    { key: 'fetch', action: 'http', credential: 'stripe', config: { url: 'https://x.test' } },
    { key: 'tell', action: 'email', config: { to: ['a@b.test'], subject: 'Hi', body: 'There' } },
  ],
});
const hero = defineTemplate({ slug: 'hero', title: 'Hero', blocks: [] });

let manablox: Manablox;
let repos: Repositories;
let content: ContentService;
let credentials: CredentialService;
let workflows: WorkflowService;
let service: CodeResourceService;
let spaceId: string;
let queries: () => readonly string[];
let resetQueries: () => void;
let close: (() => Promise<void>) | undefined;

/** Declarations as the config holds them; workflows are the plugin's resource kind. */
type Declared = Omit<Manablox['config']['resources'], 'plugins'> & {
  workflows: ReturnType<typeof defineWorkflow>[];
};

/** The reconciler over other declarations; the resolved config is frozen, so it is shadowed. */
function withResources({ workflows, ...resources }: Declared): CodeResourceService {
  const instance = Object.create(manablox) as Manablox;
  // `resolveConfig` stamps every declaration with where it came from; these bypass it.
  const stamped = {
    ...resources,
    credentials: resources.credentials.map((entry) => ({ ...entry, sourceRef: 'config' })),
    templates: resources.templates.map((entry) => ({ ...entry, sourceRef: 'config' })),
    plugins: {
      [WORKFLOW_RESOURCE_KIND]: workflows.map((entry) => ({ ...entry, sourceRef: 'config' })),
    },
  };
  Object.defineProperty(instance, 'config', {
    value: { ...manablox.config, resources: stamped },
  });
  return new CodeResourceService(instance, repos, { content, credentials });
}

const base: Declared = {
  apply: 'manual' as const,
  prune: false,
  credentials: [stripe, github],
  workflows: [notify],
  templates: [hero],
};

const find = (changes: SyncChange[], slug: string): SyncChange | undefined =>
  changes.find((change) => change.slug === slug);

beforeAll(async () => {
  const { workflows: declared, ...resources } = base;
  const harness = await createWorkflowHarness('code-resources', {
    config: { resources: { ...resources, plugins: { [WORKFLOW_RESOURCE_KIND]: declared } } },
    listen: false,
  });
  ({ manablox, repos, content, spaceId, close, credentials } = harness);
  workflows = harness.service;
  queries = harness.ctx.queries;
  resetQueries = harness.ctx.resetQueryCount;
  service = new CodeResourceService(manablox, repos, { content, credentials });
});

afterAll(async () => {
  await close?.();
});

beforeEach(async () => {
  // Every test starts from an empty space and the declarations above.
  for (const row of await workflowRepos(repos).workflows.listBySpace(spaceId)) {
    await workflowRepos(repos).workflows.delete(row.id);
  }
  for (const row of await repos.credentials.listBySpace(spaceId)) {
    await repos.credentials.delete(row.id);
  }
  // Template documents too.
  for (const row of await repos.content.listCodeBySpace(spaceId)) {
    await repos.content.setSource(row.id, 'runtime', null);
  }
  for (const locale of ['en', 'de']) {
    const id = codeTemplateId(spaceId, 'hero', locale);
    if (await repos.content.findById(id)) await repos.content.deleteReturning(id);
  }
  service = withResources(base);
});

describe('sync', () => {
  it('writes every declaration into the space, with its references resolved', async () => {
    const report = await service.sync();
    expect(report.spaces).toBe(1);
    expect(report.changes.every((change) => change.action === 'created')).toBe(true);

    const [credential] = await repos.credentials.listBySpace(spaceId);
    const [workflow] = await workflowRepos(repos).workflows.listBySpace(spaceId);

    expect(workflow).toMatchObject({
      slug: 'notify-on-publish',
      source: 'code',
      sourceRef: 'config',
      id: codeWorkflowId(spaceId, 'notify-on-publish'),
    });
    // The trigger named the type by name, and the node its credential by slug.
    expect(workflow?.trigger).toMatchObject({
      typeIds: [manablox.contentTypes.getByName('page').id],
    });
    const node = workflow?.nodes.find((entry) => entry.key === 'fetch');
    expect(node).toMatchObject({ credentialId: expect.any(String) });
    expect(node?.kind === 'action' && node.credentialId).not.toContain('@manablox:');

    expect(credential).toBeDefined();
  });

  it('resolves a call step to the declared workflow it names', async () => {
    const shared = defineWorkflow({
      slug: 'send-order',
      trigger: { kind: 'call', parameters: [{ name: 'orderId', required: true }, 'note'] },
      steps: [
        { key: 'tell', action: 'email', config: { to: ['a@b.test'], subject: 'x', body: 'y' } },
      ],
    });
    const caller = defineWorkflow({
      slug: 'on-save',
      trigger: { kind: 'event', events: ['content.saved'] },
      steps: [
        { key: 'send', call: { workflow: 'send-order', input: { orderId: '{{ content.id }}' } } },
        { key: 'after', action: 'email', config: { to: ['a@b.test'], subject: 'x', body: 'y' } },
      ],
    });
    // Declared before what it calls: the pass already knows the other trigger.
    service = withResources({ ...base, workflows: [caller, shared] });
    const report = await service.sync();
    expect(find(report.changes, 'on-save')?.action).toBe('created');

    const called = await workflowRepos(repos).workflows.findById(
      codeWorkflowId(spaceId, 'send-order'),
    );
    expect(called?.trigger).toEqual({
      kind: 'call',
      parameters: [
        { name: 'orderId', description: '', required: true },
        { name: 'note', description: '', required: false },
      ],
      output: '',
    });
    const row = await workflowRepos(repos).workflows.findById(codeWorkflowId(spaceId, 'on-save'));
    expect(row?.nodes[0]).toMatchObject({ kind: 'call', workflowId: called?.id, wait: true });
    expect(row?.edges.find((edge) => edge.to === row.nodes[1]?.id)?.fromPort).toBe('ok');
  });

  it('arrives switched off when a credential it needs is still empty', async () => {
    const crm = defineCredential({ slug: 'crm', kind: 'bearer' });
    const sync = defineWorkflow({
      slug: 'sync-crm',
      enabled: true,
      trigger: { kind: 'event', events: ['content.published'] },
      steps: [
        { key: 'push', action: 'http', credential: 'crm', config: { url: 'https://x.test' } },
      ],
    });
    const report = await withResources({
      ...base,
      credentials: [stripe, crm],
      workflows: [notify, sync],
    }).sync();
    // `crm` is declared without values, so the workflow using it is off.
    expect(find(report.changes, 'sync-crm')).toMatchObject({
      action: 'created',
      reason: 'a credential it uses is empty, so it arrives off',
    });
    const rows = await workflowRepos(repos).workflows.listBySpace(spaceId);
    expect(rows.find((row) => row.slug === 'sync-crm')?.enabled).toBe(false);
    // `stripe` has a key, so the workflow using it is on, as declared.
    expect(rows.find((row) => row.slug === 'notify-on-publish')?.enabled).toBe(true);
  });

  it('changes nothing on a second run', async () => {
    await service.sync();
    const again = await service.sync();
    expect(again.changes.filter((change) => change.action !== 'unchanged')).toEqual([]);
    const [workflow] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    expect((await workflowRepos(repos).workflows.pageVersions(workflow?.id as string)).total).toBe(
      1,
    );
  });

  it('takes stored off-grid positions as unchanged, and snaps them on a real change', async () => {
    await service.sync();
    const [stored] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    const id = stored?.id as string;
    await workflowRepos(repos).workflows.update(id, {
      nodes: (stored?.nodes ?? []).map((node) => ({
        ...node,
        ui: { x: node.ui.x + 5, y: node.ui.y - 3 },
      })),
    });

    const again = await service.sync();
    expect(find(again.changes, 'notify-on-publish')?.action).toBe('unchanged');
    expect((await workflowRepos(repos).workflows.pageVersions(id)).total).toBe(1);

    const renamed = defineWorkflow({ ...describeNotify(), name: 'Tell everyone' });
    await withResources({ ...base, workflows: [renamed] }).sync();
    const [written] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    for (const node of written?.nodes ?? []) {
      expect(node.ui.x % 16).toBe(0);
      expect(node.ui.y % 16).toBe(0);
    }
  });

  it('leaves the switch to whoever runs the install', async () => {
    await service.sync();
    const workflow = (await workflowRepos(repos).workflows.listBySpace(spaceId))[0];
    await workflowRepos(repos).workflows.update(workflow?.id as string, { enabled: false });

    await service.sync();
    expect((await workflowRepos(repos).workflows.listBySpace(spaceId))[0]?.enabled).toBe(false);
  });

  it('writes a changed declaration through', async () => {
    await service.sync();
    const renamed = defineWorkflow({ ...describeNotify(), name: 'Tell everyone' });
    const report = await withResources({ ...base, workflows: [renamed] }).sync();

    expect(find(report.changes, 'notify-on-publish')?.action).toBe('updated');
    const [workflow] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    expect(workflow).toMatchObject({ name: 'Tell everyone', publishedVersion: 2 });
    // Each write is live at once.
    const [latest] = (await workflowRepos(repos).workflows.pageVersions(workflow?.id as string))
      .items;
    expect(latest).toMatchObject({
      version: 2,
      name: 'Tell everyone',
      note: 'Synced from config',
      publishedBy: { kind: 'system', label: 'Code resources' },
    });
  });

  it('writes nothing on a dry run, and says what it would do', async () => {
    const report = await service.sync({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.changes.some((change) => change.action === 'created')).toBe(true);
    expect(await workflowRepos(repos).workflows.listBySpace(spaceId)).toEqual([]);
  });

  it('reports the same against an empty space as a real run would do to it', async () => {
    const planned = await service.sync({ dryRun: true });
    const done = await service.sync();

    // References to credentials created in the same pass resolve in a dry run.
    expect(planned.changes).toEqual(done.changes);
    expect(planned.changes.every((change) => change.action === 'created')).toBe(true);
  });

  it('reports a template once however many locales it writes', async () => {
    const report = await service.sync();
    const templates = report.changes.filter((change) => change.kind === 'template');
    expect(templates).toEqual([
      expect.objectContaining({ slug: 'hero', action: 'created', reason: '1 locale(s)' }),
    ]);
  });

  it('skips a declaration whose reference has nothing behind it', async () => {
    const broken = defineWorkflow({
      slug: 'broken',
      trigger: { kind: 'event', events: ['content.saved'], typeIds: [ref.contentType('nope')] },
      steps: [
        { key: 'tell', action: 'email', config: { to: ['a@b.test'], subject: 'x', body: 'y' } },
      ],
    });
    const report = await withResources({ ...base, workflows: [notify, broken] }).sync();

    expect(find(report.changes, 'broken')).toMatchObject({
      action: 'skipped',
      reason: 'codeResource.ref.unresolved',
    });
    // The one beside it still went in: a space that lacks one type is not a failed sync.
    expect(find(report.changes, 'notify-on-publish')?.action).toBe('created');
  });

  it('leaves a slug an admin-made row already holds alone', async () => {
    await workflowRepos(repos).workflows.create({
      spaceId,
      name: 'Mine',
      slug: 'notify-on-publish',
      trigger: { kind: 'event', events: [], typeIds: [], locales: [] },
      nodes: [],
      edges: [],
    });
    const report = await service.sync();
    expect(find(report.changes, 'notify-on-publish')).toMatchObject({ action: 'skipped' });
    expect((await workflowRepos(repos).workflows.listBySpace(spaceId))[0]?.name).toBe('Mine');
  });

  it('only touches the spaces it is asked for', async () => {
    const report = await service.sync({ spaceIds: [] });
    expect(report.spaces).toBe(0);
    expect(report.changes).toEqual([]);
  });
});

describe('prune', () => {
  it('switches off what no declaration covers any more', async () => {
    await service.sync();
    const report = await withResources({ ...base, workflows: [] }).sync();

    expect(find(report.changes, 'notify-on-publish')).toMatchObject({ action: 'disabled' });
    const [row] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    expect(row).toMatchObject({ enabled: false, source: 'code' });
  });

  it('deletes it when asked to', async () => {
    await service.sync();
    const report = await withResources({ ...base, workflows: [] }).sync({ prune: true });

    expect(find(report.changes, 'notify-on-publish')).toMatchObject({ action: 'deleted' });
    expect(await workflowRepos(repos).workflows.listBySpace(spaceId)).toEqual([]);
  });

  it('hands a credential back rather than deleting it', async () => {
    await service.sync();
    await withResources({ ...base, credentials: [stripe] }).sync({ prune: true });

    const rows = await repos.credentials.listBySpace(spaceId);
    expect(rows.find((row) => row.slug === 'github')).toMatchObject({ source: 'runtime' });
  });
});

describe('templates', () => {
  it('writes a document per locale and publishes it', async () => {
    await service.sync();
    const template = await repos.content.findById(codeTemplateId(spaceId, 'hero', 'en'));
    expect(template).toMatchObject({
      title: 'Hero',
      status: 'published',
      typeId: manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME).id,
    });
  });

  it('leaves a seeded template to the editors once it exists', async () => {
    await service.sync();
    const changed = defineTemplate({ slug: 'hero', title: 'Hero', blocks: [] });
    const report = await withResources({ ...base, templates: [changed] }).sync();
    expect(find(report.changes, 'hero')?.action).toBe('unchanged');
  });

  it('rewrites a managed template and refuses an edit from anywhere else', async () => {
    const managed = defineTemplate({ slug: 'hero', title: 'Hero', blocks: [], manage: 'managed' });
    await withResources({ ...base, templates: [managed] }).sync();

    const type = manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME);
    const row = await repos.content.findById(codeTemplateId(spaceId, 'hero', 'en'));
    expect(row).toMatchObject({ source: 'code' });

    await expect(
      content.update(spaceId, row?.id as string, {
        spaceId,
        typeId: type.id,
        title: 'Mine',
        fields: {},
      }),
    ).rejects.toThrow(/content.code.immutable/);
  });
});

describe('query cost', () => {
  /** Reads of the draft documents table. */
  const contentReads = (): number =>
    queries().filter((query) => /^\s*select/i.test(query) && /from "contents"/.test(query)).length;

  it('reads template documents in batches, however many templates and locales', async () => {
    await repos.spaces.update(spaceId, { locales: ['en', 'de'] });
    const slugs = Array.from({ length: 5 }, (_, index) => `t${index}`);
    try {
      const cost = async (count: number): Promise<number> => {
        const templates = slugs
          .slice(0, count)
          .map((slug) => defineTemplate({ slug, title: slug, blocks: [] }));
        const sync = withResources({ ...base, templates });
        await sync.sync();
        resetQueries();
        const report = await sync.sync();
        expect(report.changes.filter((change) => change.kind === 'template')).toHaveLength(count);
        return contentReads();
      };
      const one = await cost(1);
      expect(await cost(5)).toBe(one);
      // The code-owned rows for prune, and the template rows by id.
      expect(one).toBe(2);
    } finally {
      await repos.spaces.update(spaceId, { locales: ['en'] });
      for (const slug of slugs) {
        for (const locale of ['en', 'de']) {
          const id = codeTemplateId(spaceId, slug, locale);
          if (await repos.content.findById(id)) await repos.content.deleteReturning(id);
        }
      }
    }
  });
});

describe('what the admin may do to a declared row', () => {
  it('refuses an edit and a deletion, and allows the switch', async () => {
    await service.sync();
    const [row] = await workflowRepos(repos).workflows.listBySpace(spaceId);
    const id = row?.id as string;

    await expect(
      workflows.update(spaceId, id, {
        name: 'x',
        trigger: { kind: 'event', events: [], typeIds: [], locales: [] },
        nodes: [],
        edges: [],
      }),
    ).rejects.toThrow(/plugins.workflows.code.immutable/);
    await expect(workflows.delete(spaceId, id)).rejects.toThrow(/plugins.workflows.code.immutable/);
    await expect(workflows.setEnabled(spaceId, id, false)).resolves.toMatchObject({
      enabled: false,
    });
  });
});

/** The declaration `notify` was built from, so a test can rebuild it with one thing changed. */
function describeNotify() {
  return {
    slug: 'notify-on-publish',
    name: 'Tell the team',
    enabled: true,
    trigger: {
      kind: 'event' as const,
      events: ['content.published' as const],
      typeIds: [ref.contentType('page')],
    },
    steps: [
      { key: 'fetch', action: 'http', credential: 'stripe', config: { url: 'https://x.test' } },
      { key: 'tell', action: 'email', config: { to: ['a@b.test'], subject: 'Hi', body: 'There' } },
    ],
  };
}

describe('environments', () => {
  it('syncs each declaration into every environment, credentials once per space', async () => {
    const staging = await repos.environments.create({
      spaceId,
      machineName: 'staging',
      name: 'Staging',
      kind: 'staging',
    });
    try {
      const report = await service.sync();
      const scope = { spaceId, environmentId: staging.id };
      const [workflow] = await workflowRepos(repos).workflows.listBySpace(scope);
      expect(workflow).toMatchObject({
        id: codeWorkflowId(staging.id, 'notify-on-publish'),
        environmentId: staging.id,
        source: 'code',
      });
      expect(await repos.content.findById(codeTemplateId(staging.id, 'hero', 'en'))).toMatchObject({
        environmentId: staging.id,
      });
      // Production keeps its own rows under its own ids.
      expect(
        (await workflowRepos(repos).workflows.listBySpace(spaceId)).map((row) => row.id),
      ).toEqual([codeWorkflowId(spaceId, 'notify-on-publish')]);
      const stagingKinds = report.changes
        .filter((change) => change.environment === 'staging')
        .map((change) => change.kind);
      expect([...new Set(stagingKinds)].sort()).toEqual(['template', WORKFLOW_RESOURCE_KIND]);
      expect(report.changes.filter((change) => change.kind === 'credential')).toHaveLength(2);
      expect(await repos.credentials.listBySpace(spaceId)).toHaveLength(2);

      const again = await service.sync();
      expect(again.changes.every((change) => change.action === 'unchanged')).toBe(true);
    } finally {
      await repos.environments.delete(staging.id);
    }
  });
});
