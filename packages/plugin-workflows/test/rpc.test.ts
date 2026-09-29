import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManabloxError } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, createApp, type ManagementRuntime, requireManagement } from '@manablox/server';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { workflowsPlugin } from '../src/server/plugin.js';
import type { WorkflowsServices } from '../src/server/services/index.js';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let spaceId: string;
/** API keys by who holds them: the superadmin, space members by role, a named key. */
const keys: Record<'owner' | 'admin' | 'editor' | 'viewer' | 'member' | 'shop', string> = {
  owner: '',
  admin: '',
  editor: '',
  viewer: '',
  member: '',
  shop: '',
};

/** Ids the service stubs answer for; nothing looks them up. */
const WORKFLOW_ID = '00000000-0000-4000-8000-0000000000a1';
const DOC_ID = '00000000-0000-4000-8000-0000000000d1';
const NODE_ID = 'node-1';

type Holder = keyof typeof keys;

/** A procedure at `plugins.workflows`, as `as` or without a key. */
async function call(holder: Holder | null, procedure: string, input: unknown) {
  const response = await app.request(`/rpc/plugins/workflows/${procedure}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(holder ? { 'x-api-key': keys[holder] } : {}),
    },
    body: JSON.stringify({ json: input }),
  });
  const payload = (await response.json()) as { json: unknown };
  return { status: response.status, body: payload.json };
}

/** The answer of a procedure that succeeds. */
async function invoke(holder: Holder, procedure: string, input: unknown) {
  const { status, body } = await call(holder, procedure, input);
  expect(status, JSON.stringify(body)).toBe(200);
  return body;
}

/** The error of a procedure that fails, with its key and details. */
async function failure(holder: Holder | null, procedure: string, input: unknown) {
  const { status, body } = await call(holder, procedure, input);
  expect(status).not.toBe(200);
  const error = body as {
    code: string;
    message: string;
    data?: { key?: string; details?: Array<{ key: string; path?: unknown[] }> };
  };
  return {
    code: error.code,
    key: error.data?.key ?? error.message,
    ...(error.data?.details ? { details: error.data.details } : {}),
  };
}

/** The workflow service the procedures reach; tests stub its methods. */
const service = () =>
  api.manablox.plugin<WorkflowsServices>('workflows').services.workflows as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
const stub = (method: string) => vi.spyOn(service(), method as never);

/** The production environment of the test space, as procedures scope it. */
const production = () => expect.objectContaining({ spaceId });

const draft = () => ({
  spaceId,
  name: 'Ping',
  trigger: { kind: 'event' as const, events: ['content.saved' as const] },
  nodes: [
    {
      id: NODE_ID,
      key: 'ping',
      kind: 'action' as const,
      action: 'http',
      config: { url: 'https://example.test/hook' },
    },
  ],
  edges: [{ from: 'trigger', fromPort: 'out', to: NODE_ID }],
});

beforeAll(async () => {
  db = await createTestDatabase('workflows_rpc', { plugins: [workflowsPlugin()] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-workflows-rpc-'));
  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'workflows-rpc-secret-0123456789abcdef' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth'] },
      plugins: [workflowsPlugin()],
    }),
  );
  app = await createApp(api);

  const space = await api.repos.spaces.create({
    name: 'Rpc',
    machineName: 'rpc',
    url: 'https://rpc.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
  const owner = await api.repos.users.create({
    name: 'Owner',
    email: 'owner@example.com',
    role: 'superadmin',
    passwordHash: 'x',
  });
  keys.owner = (await api.apiKeys.issue(owner.id, 'owner')).key;
  keys.shop = (await api.apiKeys.issue(owner.id, 'shop')).key;
  for (const role of ['admin', 'editor', 'viewer'] as const) {
    const user = await api.repos.users.create({
      name: role,
      email: `${role}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });
    await api.repos.users.grant(user.id, spaceId, role);
    keys[role] = (await api.apiKeys.issue(user.id, role)).key;
  }
  const member = await api.repos.users.create({
    name: 'Nobody',
    email: 'nobody@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
  keys.member = (await api.apiKeys.issue(member.id, 'member')).key;
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('plugins.workflows.catalog', () => {
  it('is open to any signed-in user and closed otherwise', async () => {
    const catalog = stub('catalog').mockResolvedValue({ events: [], actions: [], operators: [] });
    expect(await invoke('member', 'catalog', {})).toEqual({
      events: [],
      actions: [],
      operators: [],
    });
    expect(catalog).toHaveBeenCalledWith(null);
    expect(await failure(null, 'catalog', {})).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('serves trigger kinds, field kinds and per-kind entries of the real catalogue', async () => {
    const catalog = (await invoke('editor', 'catalog', { spaceId })) as Record<string, unknown>;
    expect(catalog.triggerKinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'event', plugin: 'workflows' }),
        expect.objectContaining({ kind: 'manual', plugin: 'workflows' }),
      ]),
    );
    expect(catalog).toHaveProperty('fieldKinds');
    expect(catalog).toHaveProperty('triggers');
    expect(catalog).not.toHaveProperty('webhooks');
  });
});

describe('plugins.workflows.list / get', () => {
  it('needs workflows:read, which an editor holds and a viewer lacks', async () => {
    const empty = { items: [], total: 0, limit: 100, offset: 0 };
    const page = stub('page').mockResolvedValue(empty);
    expect(await invoke('editor', 'list', { spaceId })).toEqual(empty);
    expect(page).toHaveBeenCalledWith(production(), { limit: 100, offset: 0 });
    expect(await failure('viewer', 'list', { spaceId })).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maps a missing workflow to NOT_FOUND', async () => {
    stub('get').mockRejectedValue(
      ManabloxError.notFound('plugins.workflows.notFound', { id: WORKFLOW_ID }),
    );
    expect(await failure('owner', 'get', { spaceId, id: WORKFLOW_ID })).toMatchObject({
      code: 'NOT_FOUND',
      key: 'plugins.workflows.notFound',
    });
  });
});

describe('plugins.workflows.create / update', () => {
  it('needs workflows:write, which an editor lacks and an admin holds', async () => {
    stub('create').mockResolvedValue({ id: WORKFLOW_ID });
    expect(await failure('editor', 'create', draft())).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke('admin', 'create', draft())).toEqual({ id: WORKFLOW_ID });
  });

  it('fills in every node and trigger default so the service sees the whole shape', async () => {
    const create = stub('create').mockResolvedValue({ id: WORKFLOW_ID });
    await invoke('owner', 'create', draft());

    const [scope, data] = create.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(scope).toEqual(production());
    expect(data.spaceId).toBeUndefined();
    expect(data.trigger).toEqual({
      kind: 'event',
      events: ['content.saved'],
      typeIds: [],
      locales: [],
    });
    expect(data.nodes).toEqual([
      {
        id: NODE_ID,
        key: 'ping',
        name: '',
        enabled: true,
        continueOnError: false,
        join: 'any',
        ui: { x: 0, y: 0 },
        kind: 'action',
        action: 'http',
        // Passed through as written; the service validates it.
        config: { url: 'https://example.test/hook' },
        credentialId: null,
      },
    ]);
    expect(data.edges).toEqual([
      { id: '', from: 'trigger', fromPort: 'out', to: NODE_ID, guard: null },
    ]);
  });

  it('accepts a condition node and a guarded edge', async () => {
    const update = stub('update').mockResolvedValue({ id: WORKFLOW_ID });
    await invoke('owner', 'update', {
      ...draft(),
      id: WORKFLOW_ID,
      nodes: [
        {
          id: 'c1',
          key: 'check',
          kind: 'condition',
          rules: [{ field: 'content.status', operator: 'equals', value: 'published' }],
        },
        { id: 'd1', key: 'pause', kind: 'delay', minutes: 5 },
      ],
      edges: [
        { from: 'trigger', fromPort: 'out', to: 'c1' },
        {
          from: 'c1',
          fromPort: 'true',
          to: 'd1',
          guard: { rules: [{ field: 'content.locale', operator: 'equals', value: 'en' }] },
        },
      ],
    });
    const [, , data] = update.mock.calls[0] as unknown as [
      unknown,
      string,
      { nodes: unknown[]; edges: unknown[] },
    ];
    expect(data.nodes[0]).toMatchObject({ kind: 'condition', match: 'all' });
    expect(data.nodes[1]).toMatchObject({ kind: 'delay', minutes: 5, enabled: true });
    expect(data.edges[1]).toMatchObject({ fromPort: 'true', guard: { match: 'all' } });
  });

  it('refuses an unknown event and an unknown node kind before the service', async () => {
    const create = stub('create');
    expect(
      (
        await failure('owner', 'create', {
          ...draft(),
          trigger: { kind: 'event', events: ['content.exploded'] },
        })
      ).code,
    ).toBe('BAD_REQUEST');
    expect(
      (await failure('owner', 'create', { ...draft(), nodes: [{ id: 'x', kind: 'fax' }] })).code,
    ).toBe('BAD_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a service validation error to BAD_REQUEST with the node path', async () => {
    stub('create').mockRejectedValue(
      ManabloxError.validation(
        [{ key: 'plugins.workflows.node.http.urlInvalid', path: ['nodes', 0, 'config', 'url'] }],
        'plugins.workflows.validation.failed',
      ),
    );
    expect(await failure('owner', 'create', draft())).toMatchObject({
      code: 'BAD_REQUEST',
      key: 'plugins.workflows.validation.failed',
      details: [{ path: ['nodes', 0, 'config', 'url'] }],
    });
  });
});

describe('plugins.workflows.setEnabled / delete / runNow', () => {
  it('routes each to its service call with workflows:write', async () => {
    const setEnabled = stub('setEnabled').mockResolvedValue({ id: WORKFLOW_ID, enabled: true });
    stub('delete').mockResolvedValue(undefined);
    const runNow = stub('runNow').mockResolvedValue({ id: 'run' });
    const target = { spaceId, id: WORKFLOW_ID };

    await invoke('owner', 'setEnabled', { ...target, enabled: true });
    expect(setEnabled).toHaveBeenCalledWith(production(), WORKFLOW_ID, true);

    expect(await invoke('owner', 'delete', target)).toEqual({ ok: true });

    await invoke('owner', 'runNow', target);
    const blank = { contentId: null, input: null, payload: null, headers: null };
    expect(runNow).toHaveBeenCalledWith(production(), WORKFLOW_ID, blank);
    await invoke('owner', 'runNow', { ...target, contentId: DOC_ID });
    expect(runNow).toHaveBeenLastCalledWith(production(), WORKFLOW_ID, {
      ...blank,
      contentId: DOC_ID,
    });
    // A called workflow is run with its values.
    await invoke('owner', 'runNow', { ...target, input: { orderId: '42' } });
    expect(runNow).toHaveBeenLastCalledWith(production(), WORKFLOW_ID, {
      ...blank,
      input: { orderId: '42' },
    });
    // A workflow of a contributed kind, e.g. a webhook's, is run with a sample call.
    await invoke('owner', 'runNow', { ...target, payload: { body: { action: 'opened' } } });
    expect(runNow).toHaveBeenLastCalledWith(production(), WORKFLOW_ID, {
      ...blank,
      payload: { body: { action: 'opened' }, query: {}, method: 'POST' },
    });
  });

  it('starts a manual workflow with its values', async () => {
    const start = stub('start').mockResolvedValue({ id: 'run' });
    await invoke('owner', 'start', { spaceId, id: WORKFLOW_ID });
    expect(start).toHaveBeenCalledWith(production(), WORKFLOW_ID, {});
    await invoke('owner', 'start', { spaceId, id: WORKFLOW_ID, input: { note: 'hi' } });
    expect(start).toHaveBeenLastCalledWith(production(), WORKFLOW_ID, { note: 'hi' });
  });

  it('lets an editor read runs but not start one', async () => {
    const runHistory = stub('runHistory').mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    const target = { spaceId, id: WORKFLOW_ID };
    await invoke('editor', 'runHistory', target);
    expect(runHistory).toHaveBeenCalledWith(
      production(),
      WORKFLOW_ID,
      { status: undefined, test: undefined },
      { limit: 25, offset: 0 },
    );
    expect(await failure('editor', 'runNow', target)).toMatchObject({ code: 'FORBIDDEN' });
    expect(await failure('editor', 'start', target)).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('a malformed space id', () => {
  it('is refused by the schema before any space is looked up', async () => {
    const findById = vi.spyOn(api.repos.spaces, 'findById');
    const start = stub('start');
    expect(
      await failure('owner', 'start', { spaceId: 'not-a-uuid', id: WORKFLOW_ID }),
    ).toMatchObject({ code: 'BAD_REQUEST' });
    expect(findById).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('plugins.workflows.abortRun / abortRuns', () => {
  it('records who asked, a key by its name', async () => {
    const abortRun = stub('abortRun').mockResolvedValue({ id: 'run', status: 'aborted' });
    const abortRuns = stub('abortRuns').mockResolvedValue({ aborted: ['run'] });
    const target = { spaceId, id: WORKFLOW_ID };

    await invoke('owner', 'abortRun', { ...target, reason: 'wrong order' });
    expect(abortRun).toHaveBeenCalledWith(production(), WORKFLOW_ID, {
      actor: 'API key owner',
      reason: 'wrong order',
    });

    expect(await invoke('shop', 'abortRuns', target)).toEqual({ aborted: ['run'] });
    expect(abortRuns).toHaveBeenCalledWith(production(), WORKFLOW_ID, {
      actor: 'API key shop',
      reason: undefined,
    });
  });

  it('needs workflows:write', async () => {
    expect(await failure('editor', 'abortRun', { spaceId, id: WORKFLOW_ID })).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('plugins.workflows.export / import', () => {
  it('lets a reader export and a writer import a checked file', async () => {
    const exported = stub('export').mockResolvedValue({ format: 'manablox.workflow' });
    const imported = stub('import').mockResolvedValue({
      workflow: { id: WORKFLOW_ID },
      notes: [],
    });
    await invoke('editor', 'export', { spaceId, id: WORKFLOW_ID });
    expect(exported).toHaveBeenCalledWith(production(), WORKFLOW_ID, null);

    const { spaceId: _spaceId, ...body } = draft();
    // A contributed trigger kind and the records list it carries pass the schema as written.
    const hook = { id: 'hook-in-file', name: 'Orders', slug: 'orders' };
    const file = {
      format: 'manablox.workflow',
      version: 1,
      workflow: { ...body, trigger: { kind: 'webhook', webhookId: 'hook-in-file' } },
      webhooks: [hook],
    };
    expect(await failure('editor', 'import', { spaceId, file })).toMatchObject({
      code: 'FORBIDDEN',
    });

    await invoke('owner', 'import', { spaceId, file });
    const [, passed] = imported.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    // File-local ids pass the schema; the service maps them.
    expect(passed.workflow).toMatchObject({
      trigger: { kind: 'webhook', webhookId: 'hook-in-file' },
      abortTriggers: [],
    });
    expect(passed).toMatchObject({ credentials: [], workflows: [], webhooks: [hook] });

    expect(await failure('owner', 'import', { spaceId, file: { format: 'other' } })).toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('plugins.workflows versions', () => {
  it('lets a reader see versions and only a writer publish or restore', async () => {
    const page = { items: [{ version: 1 }], total: 1, limit: 10, offset: 0 };
    const versions = stub('versions').mockResolvedValue(page);
    const version = stub('version').mockResolvedValue({ version: 1 });
    const publish = stub('publish').mockResolvedValue({
      workflow: { id: WORKFLOW_ID },
      version: { version: 2 },
    });
    const restoreVersion = stub('restoreVersion').mockResolvedValue({ id: WORKFLOW_ID });
    const target = { spaceId, id: WORKFLOW_ID };

    expect(await invoke('editor', 'versions', { ...target, pagination: { limit: 10 } })).toEqual(
      page,
    );
    expect(versions).toHaveBeenCalledWith(production(), WORKFLOW_ID, { limit: 10, offset: 0 });
    await invoke('editor', 'version', { ...target, version: 1 });
    expect(version).toHaveBeenCalledWith(production(), WORKFLOW_ID, 1);
    expect(await failure('editor', 'publish', target)).toMatchObject({ code: 'FORBIDDEN' });
    expect(await failure('editor', 'restoreVersion', { ...target, version: 1 })).toMatchObject({
      code: 'FORBIDDEN',
    });

    await invoke('admin', 'publish', { ...target, note: 'Tighter filter' });
    expect(publish).toHaveBeenCalledWith(production(), WORKFLOW_ID, 'Tighter filter');
    await invoke('admin', 'restoreVersion', { ...target, version: 1 });
    expect(restoreVersion).toHaveBeenCalledWith(production(), WORKFLOW_ID, 1);
  });

  it('hands publish and its note on a save to the service', async () => {
    const update = stub('update').mockResolvedValue({ id: WORKFLOW_ID });
    await invoke('owner', 'update', {
      ...draft(),
      id: WORKFLOW_ID,
      publish: true,
      note: 'First cut',
    });
    const [, , data, options] = update.mock.calls[0] as unknown as [
      unknown,
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(options).toEqual({ publish: true, note: 'First cut' });
    expect(data.publish).toBeUndefined();
    expect(data.note).toBeUndefined();
  });

  it('pages the run history with its filters', async () => {
    const runHistory = stub('runHistory').mockResolvedValue({
      items: [],
      total: 0,
      limit: 10,
      offset: 20,
    });
    await invoke('owner', 'runHistory', {
      spaceId,
      id: WORKFLOW_ID,
      status: ['failed'],
      test: false,
      pagination: { limit: 10, offset: 20 },
    });
    expect(runHistory).toHaveBeenCalledWith(
      production(),
      WORKFLOW_ID,
      { status: ['failed'], test: false },
      { limit: 10, offset: 20 },
    );
  });
});
