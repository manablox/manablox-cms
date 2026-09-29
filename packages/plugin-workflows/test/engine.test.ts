import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ContentService, CredentialService, MailMessage } from '@manablox/services';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineWorkflowAction } from '../src/define/action.js';
import type { WorkflowNode } from '../src/sdk.js';
import { WORKFLOW_TRIGGER_ID } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { WorkflowEngine } from '../src/server/engine/index.js';
import { WorkflowService } from '../src/server/services/workflow.service.js';
import {
  action as act,
  base,
  chain,
  condition as check,
  edge as link,
  onEvents,
  delay as wait,
} from './helpers/graph.js';
import { createWorkflowHarness, START, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let manablox: Manablox;
let repos: Repositories;
let content: ContentService;
let engine: WorkflowEngine;
let credentials: CredentialService;
let service: WorkflowService;
let spaceId: string;
let pageType: string;
let noteType: string;
let workflow: WorkflowHarness['workflow'];
let page: WorkflowHarness['page'];

const mails: MailMessage[] = [];
const calls: Array<{ url: string; init: RequestInit }> = [];
let clock = START;
let fetchStatus = 200;
let fetchBody = '{"ok":true}';

const email = (
  key = 'notify',
  config: Record<string, unknown> = {},
  extra: Partial<WorkflowNode> = {},
) =>
  act(
    key,
    'email',
    {
      to: ['ops@example.com'],
      toRoles: [],
      subject: '{{ event }}: {{ content.title }}',
      body: 'By {{ actor.email }}',
      html: false,
      ...config,
    },
    extra,
  );

const http = (
  key = 'call',
  config: Record<string, unknown> = {},
  extra: Partial<WorkflowNode> = {},
) =>
  act(
    key,
    'http',
    {
      method: 'POST',
      url: 'https://hooks.test/x',
      headers: [],
      body: { mode: 'none', template: '' },
      secret: null,
      timeoutMs: 5000,
      allowErrorStatus: false,
      ...config,
    },
    extra,
  );

const statuses = async (workflowId: string) =>
  (await h.runsOf(workflowId))[0]?.log.map((entry) => [entry.key, entry.status]);

beforeAll(async () => {
  h = await createWorkflowHarness('workflows', {
    contentTypes: [
      { name: 'page', fields: [{ name: 'category', type: 'string' }] },
      { name: 'note', fields: [] },
    ],
    config: {
      server: { adminUrl: 'https://admin.test' },
      // The stub fetch never resolves a name, but the guard would still refuse one.
      net: { allowPrivateNetwork: true },
    },
    engine: {
      mailer: {
        async send(message) {
          mails.push(message);
          return { id: 'msg-1' };
        },
      },
      pusher: null,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        calls.push({
          url: String(request?.url ?? input),
          init: request
            ? { method: request.method, headers: request.headers, body: await request.text() }
            : (init ?? {}),
        });
        // An address on `.fail` always fails, so one call in a run can fail and not the rest.
        return new Response(fetchBody, {
          status: String(request?.url ?? input).includes('.fail/') ? 500 : fetchStatus,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      now: () => clock,
    },
  });
  ({ manablox, repos, content, engine, credentials, service, spaceId, pageType, workflow, page } =
    h);
  noteType = h.ctx.ids.note as string;
  // The engine reads the space's URL for the links it hands to actions.
  await repos.spaces.update(spaceId, { url: 'https://site.test' });
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  clock = START;
  mails.length = 0;
  calls.length = 0;
  fetchStatus = 200;
  fetchBody = '{"ok":true}';
  for (const row of await workflowRepos(repos).workflows.listBySpace(spaceId))
    await workflowRepos(repos).workflows.delete(row.id);
});

describe('event workflows', () => {
  it('runs an email action when a matching document is saved', async () => {
    const wf = await workflow('Notify', onEvents(['content.saved'], [pageType]), chain(email()));
    const user = await repos.users.create({
      name: 'Ann',
      email: 'ann@example.com',
      role: 'editor',
      passwordHash: 'x',
    });

    const row = await content.create(
      { spaceId, typeId: pageType, locale: 'en', title: 'Launch', slug: 'launch', fields: {} },
      { userId: user.id, roles: ['owner'] },
    );
    await engine.idle();

    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      to: ['ops@example.com'],
      subject: 'content.created: Launch',
      text: 'By ann@example.com',
    });

    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    expect(run?.trigger).toBe('content.created');
    expect(run?.context.content).toMatchObject({ id: row.id, title: 'Launch' });
    expect(run?.context.url).toBe(`https://admin.test/content/${row.id}`);
    expect(run?.log.map((entry) => entry.status)).toEqual(['ok']);
  });

  it('ignores other types, other events and disabled workflows', async () => {
    await workflow('Pages only', onEvents(['content.saved'], [pageType]), chain(email()));
    await workflow('Publish only', onEvents(['content.published']), chain(email()));
    await workflow('Off', onEvents(['content.saved']), chain(email()), { enabled: false });

    await page('A note', {}, noteType);
    await engine.idle();
    expect(mails).toHaveLength(0);
  });

  it('carries the previous row on update so conditions can see what changed', async () => {
    const wf = await workflow(
      'Category changed',
      onEvents(['content.updated']),
      chain(
        check('changed', [{ field: 'content.fields.category', operator: 'changed', value: '' }]),
        email('notify', {
          subject: 'now {{ content.fields.category }}, was {{ previous.fields.category }}',
        }),
      ),
    );
    const row = await page('Cat', { category: 'news' });
    await engine.idle();

    await content.update(spaceId, row.id, {
      spaceId,
      typeId: pageType,
      locale: 'en',
      title: 'Cat',
      slug: 'cat',
      fields: { category: 'news' },
    });
    await engine.idle();
    expect(mails).toHaveLength(0);
    let runs = await h.runsOf(wf.id);
    // The rules did not hold and nothing hangs off the "no" side, so nothing acted.
    expect(runs[0]?.status).toBe('skipped');
    expect(runs[0]?.log[0]).toMatchObject({ key: 'changed', kind: 'condition', status: 'ok' });

    await content.update(spaceId, row.id, {
      spaceId,
      typeId: pageType,
      locale: 'en',
      title: 'Cat',
      slug: 'cat',
      fields: { category: 'sport' },
    });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['now sport, was news']);
    runs = await h.runsOf(wf.id);
    expect(runs[0]?.status).toBe('succeeded');
  });

  it('calls an API with the signed event body and records the response', async () => {
    const wf = await workflow(
      'Sync',
      onEvents(['content.deleted']),
      chain(
        http('sync', {
          url: 'https://hooks.test/{{ event }}',
          headers: [{ name: 'x-token', value: 'abc' }],
          body: { mode: 'event', template: '' },
          secret: 's3cret',
        }),
      ),
    );
    const row = await page('Gone');
    await engine.idle();
    await content.delete(spaceId, row.id);
    await engine.idle();

    expect(calls).toHaveLength(1);
    const call = calls[0] as (typeof calls)[number];
    expect(call.url).toBe('https://hooks.test/content.deleted');
    const headers = new Headers(call.init.headers);
    expect(headers.get('x-token')).toBe('abc');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-manablox-signature')).toMatch(/^sha256=[0-9a-f]{64}$/);
    const body = JSON.parse(String(call.init.body));
    expect(body.content).toMatchObject({ id: row.id, title: 'Gone' });
    expect(body.event).toBe('content.deleted');

    const [run] = await h.runsOf(wf.id);
    expect(run?.log[0]).toMatchObject({ action: 'http', status: 'ok', detail: { status: 200 } });
  });

  it('renders a custom JSON body with typed placeholders', async () => {
    await workflow(
      'Custom',
      onEvents(['content.created']),
      chain(
        http('call', {
          method: 'PUT',
          body: {
            mode: 'custom',
            template:
              '{"title":"{{ content.title }}","doc":"{{ content }}","v":"{{ content.version }}"}',
          },
        }),
      ),
    );
    const row = await page('Typed');
    await engine.idle();
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.title).toBe('Typed');
    expect(body.doc.id).toBe(row.id);
    expect(body.v).toBe(1);
  });

  it('marks the run failed on an error and continues past one flagged continueOnError', async () => {
    fetchStatus = 503;
    const wf = await workflow(
      'Fragile',
      onEvents(['content.created']),
      chain(
        http('first', { url: 'https://down.test' }, { continueOnError: true }),
        http('second', { url: 'https://down.test' }),
        email(),
      ),
    );
    await page('Breaks');
    await engine.idle();

    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('failed');
    expect(run?.log.map((entry) => entry.status)).toEqual(['failed', 'failed']);
    expect(run?.error).toContain('HTTP 503');
    expect(mails).toHaveLength(0);
  });

  it('reports a missing mailer in the run rather than throwing at the save', async () => {
    const bare = new WorkflowEngine(manablox, repos, { registry: h.registry, now: () => clock });
    const wf = await workflow('No mail', onEvents(['content.created']), chain(email()));
    const run = await new WorkflowService(manablox, repos, bare, credentials).runNow(
      spaceId,
      wf.id,
      { contentId: (await page('Plain')).id },
    );
    expect(run.status).toBe('failed');
    expect(run.error).toBe('mail.notConfigured');
  });

  it('sends to members by role and skips a node that is switched off', async () => {
    const editor = await repos.users.create({
      name: 'Ed',
      email: 'ed@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    const viewer = await repos.users.create({
      name: 'Vi',
      email: 'vi@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    await repos.users.grant(editor.id, spaceId, 'editor');
    await repos.users.grant(viewer.id, spaceId, 'viewer');

    const wf = await workflow(
      'Roles',
      onEvents(['content.created']),
      chain(
        email('by_role', { to: [], toRoles: ['editor'] }),
        email('switched_off', {}, { enabled: false }),
      ),
    );
    await page('Roles');
    await engine.idle();

    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toEqual(['ed@example.com']);
    expect(await statuses(wf.id)).toEqual([
      ['by_role', 'ok'],
      ['switched_off', 'skipped'],
    ]);
  });
});

describe('data flowing between nodes', () => {
  it("makes a call's response readable by everything downstream", async () => {
    fetchBody = JSON.stringify({ order: { id: 42, customer: 'Ada' }, total: 99 });
    const fetchNode = http('fetch', { method: 'GET', body: { mode: 'none', template: '' } });
    const shape = act('summary', 'transform.json', {
      template:
        '{"who":"{{ nodes.fetch.body.order.customer }}","total":"{{ nodes.fetch.body.total }}"}',
    });
    const wf = await workflow(
      'Pass it on',
      onEvents(['content.created']),
      chain(
        fetchNode,
        shape,
        email('tell', {
          subject: 'order {{ nodes.fetch.body.order.id }} for {{ nodes.summary.who }}',
          body: 'total {{ nodes.summary.total }}',
        }),
      ),
    );
    await page('Order');
    await engine.idle();

    expect(mails[0]?.subject).toBe('order 42 for Ada');
    expect(mails[0]?.text).toBe('total 99');
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    // A placeholder alone keeps its type, so a rule can compare the number as a number.
    expect(run?.state.outputs.summary?.value).toEqual({ who: 'Ada', total: 99 });
  });

  it('hands an action the outputs of the nodes whose lines led to it', async () => {
    const seen: Record<string, unknown>[] = [];
    if (!h.registry.actions.has('test.inputs')) {
      h.registry.actions.register(
        defineWorkflowAction({
          type: 'test.inputs',
          label: 'Record inputs',
          description: '',
          icon: 'bug',
          tone: 'plain',
          group: 'data',
          inputs: [{ name: 'in', label: 'In', type: 'any' }],
          ports: [],
          output: { name: 'ok', label: 'Out', type: 'json' },
          outputPaths: [],
          credential: null,
          fields: [],
          defaults: () => ({}),
          execute: async (ctx) => {
            seen.push(ctx.inputs);
            return { kind: 'ok', output: { from: ctx.node.key } };
          },
        }),
      );
    }
    fetchBody = JSON.stringify({ total: 3 });
    await workflow(
      'Inputs',
      onEvents(['content.created']),
      chain(
        http('fetch', { method: 'GET', body: { mode: 'none', template: '' } }),
        act('first', 'test.inputs', {}),
        act('second', 'test.inputs', {}),
      ),
    );
    await page('Inputs');
    await engine.idle();

    // The first follows the trigger through the call; only the call is its input.
    expect(Object.keys(seen[0] ?? {})).toEqual(['fetch']);
    expect(seen[0]?.fetch).toMatchObject({ body: { total: 3 } });
    expect(seen[1]).toEqual({ first: { from: 'first' } });
  });

  it('lets a condition branch on what the call answered', async () => {
    fetchBody = JSON.stringify({ status: 'stale' });
    const fetchNode = http('fetch', { method: 'GET' });
    const decide = check('fresh', [
      { field: 'nodes.fetch.body.status', operator: 'equals', value: 'fresh' },
    ]);
    const yes = email('yes', { subject: 'fresh' });
    const no = email('no', { subject: 'stale' });
    const wf = await workflow('Branch on the answer', onEvents(['content.created']), {
      nodes: [fetchNode, decide, yes, no],
      edges: [
        link(WORKFLOW_TRIGGER_ID, fetchNode.id, 'out'),
        link(fetchNode.id, decide.id),
        link(decide.id, yes.id, 'true'),
        link(decide.id, no.id, 'false'),
      ],
    });

    await page('Check');
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['stale']);

    mails.length = 0;
    fetchBody = JSON.stringify({ status: 'fresh' });
    await page('Check again');
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['fresh']);
    expect(await statuses(wf.id)).toEqual([
      ['fetch', 'ok'],
      ['fresh', 'ok'],
      ['yes', 'ok'],
    ]);
  });

  it('refuses a reference to a node that does not run first', async () => {
    const first = email('first');
    const second = email('second', { subject: '{{ nodes.first.subject }}' });
    // Referring forwards: `second` runs before `first`, so `nodes.first` is empty there.
    await expect(
      workflow('Backwards', onEvents(['content.created']), {
        nodes: [second, first],
        edges: [link(WORKFLOW_TRIGGER_ID, second.id, 'out'), link(second.id, first.id)],
      }),
    ).rejects.toMatchObject({
      details: [{ key: 'plugins.workflows.reference.notUpstream' }],
    });
  });
});

describe('ports and joins', () => {
  it('takes the error port instead of failing the run', async () => {
    fetchStatus = 500;
    const call = http('call', { url: 'https://down.test' });
    const rescue = email('rescue', { subject: 'it broke' });
    const after = email('after', { subject: 'never' });
    const wf = await workflow('Catch', onEvents(['content.created']), {
      nodes: [call, rescue, after],
      edges: [
        link(WORKFLOW_TRIGGER_ID, call.id, 'out'),
        link(call.id, rescue.id, 'error'),
        link(call.id, after.id, 'ok'),
      ],
    });
    await page('Boom');
    await engine.idle();

    expect(mails.map((mail) => mail.subject)).toEqual(['it broke']);
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    expect(run?.log.map((entry) => entry.status)).toEqual(['failed', 'ok']);
  });

  it('waits for every incoming line when the node says to join on all', async () => {
    const split = check('split', [{ field: 'content.title', operator: 'isNotEmpty', value: '' }]);
    const left = email('left', { subject: 'left' });
    const right = email('right', { subject: 'right' });
    const merge = email('merge', { subject: 'merged' }, { join: 'all' });
    const wf = await workflow('Diamond', onEvents(['content.created']), {
      nodes: [split, left, right, merge],
      edges: [
        link(WORKFLOW_TRIGGER_ID, split.id, 'out'),
        link(split.id, left.id, 'true'),
        link(split.id, right.id, 'true'),
        link(left.id, merge.id),
        link(right.id, merge.id),
      ],
    });
    await page('Both');
    await engine.idle();

    // `merge` runs once, and only after both sides have.
    expect(mails.map((mail) => mail.subject)).toEqual(['left', 'right', 'merged']);
    expect(await statuses(wf.id)).toEqual([
      ['split', 'ok'],
      ['left', 'ok'],
      ['right', 'ok'],
      ['merge', 'ok'],
    ]);
  });

  it('does not wait for a line that can never arrive', async () => {
    const decide = check('decide', [
      { field: 'content.fields.category', operator: 'equals', value: 'news' },
    ]);
    const yes = email('yes', { subject: 'yes' });
    const merge = email('merge', { subject: 'merged' }, { join: 'all' });
    await workflow('Dead side', onEvents(['content.created']), {
      nodes: [decide, yes, merge],
      edges: [
        link(WORKFLOW_TRIGGER_ID, decide.id, 'out'),
        link(decide.id, yes.id, 'true'),
        link(decide.id, merge.id, 'false'),
        link(yes.id, merge.id),
      ],
    });
    await page('News', { category: 'news' });
    await engine.idle();
    // The `false` edge is dead the moment the rules hold, so the join stops waiting on it.
    expect(mails.map((mail) => mail.subject)).toEqual(['yes', 'merged']);
  });

  it('takes a line only when its own guard holds', async () => {
    const start = email('start', { subject: 'start' });
    const guarded = email('guarded', { subject: 'guarded' });
    await workflow('Guard', onEvents(['content.created']), {
      nodes: [start, guarded],
      edges: [
        link(WORKFLOW_TRIGGER_ID, start.id, 'out'),
        {
          ...link(start.id, guarded.id),
          guard: {
            match: 'all',
            rules: [{ field: 'content.fields.category', operator: 'equals', value: 'news' }],
          },
        },
      ],
    });

    await page('Guard sport', { category: 'sport' });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['start']);

    mails.length = 0;
    await page('Guard news', { category: 'news' });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['start', 'guarded']);
  });
});

describe('delays', () => {
  it('pauses the run and resumes it from the tick once the time has come', async () => {
    const wf = await workflow(
      'Later',
      onEvents(['content.created']),
      chain(wait('pause', 5), email('after', { subject: 'after the wait' })),
    );
    await page('Patience');
    await engine.idle();

    let [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('waiting');
    expect(run?.resumeAt?.toISOString()).toBe('2026-09-06T14:34:30.000Z');
    expect(mails).toHaveLength(0);
    // Stored as plain arrays, so the state survives JSON.
    expect(run?.state).toMatchObject({
      dead: [],
      done: [expect.any(String)],
      ready: [expect.any(String)],
    });
    expect(run?.state.fired).toHaveLength(2);

    await engine.tick(new Date('2026-09-06T14:33:00.000Z'));
    await engine.idle();
    expect(mails).toHaveLength(0);

    clock = new Date('2026-09-06T14:35:00.000Z');
    await engine.tick(clock);
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['after the wait']);
    [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    expect(run?.log.map((entry) => entry.status)).toEqual(['waiting', 'ok']);
  });

  it('keeps what earlier nodes produced across the pause', async () => {
    fetchBody = JSON.stringify({ ticket: 'T-7' });
    const wf = await workflow(
      'Remember',
      onEvents(['content.created']),
      chain(
        http('open', { method: 'GET' }),
        wait('pause', 5),
        email('tell', { subject: 'ticket {{ nodes.open.body.ticket }}' }),
      ),
    );
    await page('Ticket');
    await engine.idle();
    expect(mails).toHaveLength(0);

    // The output is read back from the stored run.
    fetchBody = '{}';
    clock = new Date('2026-09-06T14:35:00.000Z');
    await engine.tick(clock);
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['ticket T-7']);
    expect((await h.runsOf(wf.id))[0]?.status).toBe('succeeded');
  });
});

describe('credentials', () => {
  it('signs the request with the stored token and keeps it out of the log', async () => {
    const credential = await credentials.create(spaceId, {
      name: 'Partner API',
      kind: 'bearer',
      data: { token: 'super-secret-token' },
    });
    const call = http('call', {
      headers: [{ name: 'x-echo', value: 'super-secret-token' }],
    });
    const wf = await workflow('Signed', onEvents(['content.created']), {
      nodes: [{ ...call, credentialId: credential.id } as WorkflowNode],
      edges: [link(WORKFLOW_TRIGGER_ID, call.id, 'out')],
    });
    await page('Signed');
    await engine.idle();

    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer super-secret-token');

    const [run] = await h.runsOf(wf.id);
    expect(JSON.stringify(run?.log)).not.toContain('super-secret-token');
    // The view never carries the secret either - only enough to tell two keys apart.
    const [view] = (await credentials.page(spaceId)).items;
    expect(view?.hint).toBe('oken');
    expect(JSON.stringify(view)).not.toContain('super-secret-token');
  });

  it('refuses a credential of the wrong kind, and one from another space', async () => {
    const smtp = await credentials.create(spaceId, {
      name: 'Mailbox',
      kind: 'smtp',
      data: { url: 'smtps://user:pass@mail.test', from: 'bot@example.com' },
    });
    const call = http('call');
    await expect(
      workflow('Wrong kind', onEvents(['content.created']), {
        nodes: [{ ...call, credentialId: smtp.id } as WorkflowNode],
        edges: [link(WORKFLOW_TRIGGER_ID, call.id, 'out')],
      }),
    ).rejects.toMatchObject({ details: [{ key: 'plugins.workflows.action.credentialKind' }] });

    const other = await repos.spaces.create({
      name: 'Other',
      machineName: 'other-cred',
      url: 'https://other.test',
    });
    await expect(credentials.resolve(other.id, smtp.id)).rejects.toMatchObject({
      key: 'credential.notFound',
    });
  });
});

describe('scheduled workflows', () => {
  it('starts at the cron minute, once, with the selected documents', async () => {
    await page('Fresh one', { category: 'x' });
    await page('Fresh two', { category: 'y' });
    await engine.idle();

    const wf = await workflow(
      'Digest',
      {
        kind: 'schedule',
        cron: '30 14 * * *',
        timezone: 'UTC',
        selection: { typeIds: [pageType], status: 'any', changedWithinHours: 24, locale: null },
        perDocument: false,
      },
      chain(email('digest', { subject: '{{ documents.length }} documents' })),
    );

    await engine.tick(new Date('2026-09-06T14:29:59.000Z'));
    await engine.idle();
    expect(mails).toHaveLength(0);

    await engine.tick(new Date('2026-09-06T14:30:05.000Z'));
    await engine.tick(new Date('2026-09-06T14:30:45.000Z'));
    await engine.idle();
    expect(mails).toHaveLength(1);
    expect(Number(mails[0]?.subject.split(' ')[0])).toBeGreaterThanOrEqual(2);

    const runs = await h.runsOf(wf.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe('schedule');
    expect(runs[0]?.context.documents.length).toBeGreaterThanOrEqual(2);
  });

  it('runs once per document when asked', async () => {
    const wf = await workflow(
      'Each',
      {
        kind: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'Europe/Vienna',
        selection: { typeIds: [noteType], status: 'draft', changedWithinHours: null, locale: 'en' },
        perDocument: true,
      },
      chain(email('each', { subject: 'about {{ content.title }}' })),
    );
    await page('Note A', {}, noteType);
    await page('Note B', {}, noteType);
    await engine.idle();

    // Monday 7 September 2026, 09:00 Vienna summer time = 07:00 UTC.
    await engine.tick(new Date('2026-09-07T07:00:10.000Z'));
    await engine.idle();

    expect(mails.map((mail) => mail.subject).sort()).toEqual([
      'about A note',
      'about Note A',
      'about Note B',
    ]);
    expect((await h.runsOf(wf.id)).every((run) => run.status === 'succeeded')).toBe(true);
  });

  it('can be run by hand, and an event workflow needs a document for that', async () => {
    const scheduled = await workflow(
      'Manual',
      { kind: 'schedule', cron: '0 0 * * *', timezone: 'UTC', selection: null, perDocument: false },
      chain(email('manual', { subject: 'manual {{ event }}' })),
    );
    const run = await service.runNow(spaceId, scheduled.id);
    expect(run.status).toBe('succeeded');
    expect(run.trigger).toBe('manual');
    expect(mails[0]?.subject).toBe('manual manual');

    const evented = await workflow('Needs doc', onEvents(['content.created']), chain(email()));
    await expect(service.runNow(spaceId, evented.id)).rejects.toMatchObject({
      key: 'plugins.workflows.run.documentRequired',
    });
  });
});

describe('service rules', () => {
  it('rejects a workflow from another space and validates on save', async () => {
    const other = await repos.spaces.create({ name: 'O', machineName: 'o', url: 'https://o.test' });
    const wf = await workflow('Mine', onEvents(['content.created']), chain(email()));
    await expect(service.get(other.id, wf.id)).rejects.toMatchObject({
      key: 'plugins.workflows.notFound',
    });
    await expect(
      service.update(spaceId, wf.id, { name: '', trigger: wf.trigger, nodes: [], edges: [] }),
    ).rejects.toMatchObject({ key: 'plugins.workflows.validation.failed' });
    const flipped = await service.setEnabled(spaceId, wf.id, false);
    expect(flipped.enabled).toBe(false);
  });

  it('serves every installed action, with its form, in the catalogue', async () => {
    const catalog = await service.catalog(spaceId);
    const types = catalog.actions.map((action) => action.type);
    expect(types).toContain('http');
    expect(types).toContain('email');
    expect(types).toContain('crawl.site');
    const httpAction = catalog.actions.find((action) => action.type === 'http');
    expect(httpAction?.fields.map((field) => field.name)).toContain('url');
    expect(httpAction?.defaults).toMatchObject({ method: 'POST', timeoutMs: 10_000 });
  });
});

describe('duplicating', () => {
  it('copies the graph and leaves the copy switched off', async () => {
    const original = await workflow('Nightly sync', onEvents(['content.created']), chain(email()));
    const copy = await service.duplicate(spaceId, original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Nightly sync (copy)');
    // Disabled, so a copy cannot double-fire the original's actions.
    expect(copy.enabled).toBe(false);
    expect(copy.nodes).toEqual(original.nodes);
    expect(copy.edges).toEqual(original.edges);
    expect(copy.trigger).toEqual(original.trigger);
    expect(copy.source).toBe('runtime');
  });

  it('counts up rather than making a second list of identical names', async () => {
    const original = await workflow('Twice', onEvents(['content.created']), chain(email()));
    const first = await service.duplicate(spaceId, original.id);
    const second = await service.duplicate(spaceId, original.id);
    const third = await service.duplicate(spaceId, first.id);

    expect(new Set([first.name, second.name, third.name]).size).toBe(3);
    expect(second.name).toBe('Twice (copy 2)');
  });

  it('does not copy a workflow of another space', async () => {
    const other = await repos.spaces.create({ name: 'C', machineName: 'c', url: 'https://c.test' });
    const wf = await workflow('Mine', onEvents(['content.created']), chain(email()));
    await expect(service.duplicate(other.id, wf.id)).rejects.toMatchObject({
      key: 'plugins.workflows.notFound',
    });
  });
});

describe('loops', () => {
  const loop = (key: string, items: string, extra: Partial<WorkflowNode> = {}) =>
    ({ ...base(key), kind: 'loop', items, maxItems: 50, ...extra }) as WorkflowNode;

  it('runs its branch once per item, then carries on after the last', async () => {
    fetchBody = JSON.stringify({ people: [{ name: 'Ada' }, { name: 'Grace' }] });
    const fetchNode = http('fetch', { method: 'GET' });
    const each = loop('each', '{{ nodes.fetch.body.people }}');
    const greet = email('greet', { subject: 'Hi {{ item.name }} ({{ loop.index }})' });
    const after = email('after', { subject: '{{ nodes.each.count }} greeted' });
    const wf = await workflow('Greet everyone', onEvents(['content.created']), {
      nodes: [fetchNode, each, greet, after],
      edges: [
        link(WORKFLOW_TRIGGER_ID, fetchNode.id, 'out'),
        link(fetchNode.id, each.id),
        link(each.id, greet.id, 'each'),
        link(each.id, after.id, 'done'),
      ],
    });
    await page('People');
    await engine.idle();

    expect(mails.map((mail) => mail.subject)).toEqual(['Hi Ada (0)', 'Hi Grace (1)', '2 greeted']);
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    expect(
      run?.log.filter((entry) => entry.key === 'greet').map((entry) => entry.iteration),
    ).toEqual([0, 1]);
    const results = (run?.state.outputs.each?.value as { results: Array<Record<string, unknown>> })
      .results;
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('greet');
  });

  it('takes the list the previous node produced when it names none, up to its limit', async () => {
    fetchBody = JSON.stringify([1, 2, 3, 4]);
    const fetchNode = http('fetch', { method: 'GET' });
    const each = loop('each', '', { maxItems: 3 } as Partial<WorkflowNode>);
    const tell = email('tell', { subject: 'number {{ item }}' });
    await workflow('Numbers', onEvents(['content.created']), {
      nodes: [fetchNode, each, tell],
      edges: [
        link(WORKFLOW_TRIGGER_ID, fetchNode.id, 'out'),
        link(fetchNode.id, each.id),
        link(each.id, tell.id, 'each'),
      ],
    });
    await page('Numbers');
    await engine.idle();

    expect(mails.map((mail) => mail.subject)).toEqual(['number 1', 'number 2', 'number 3']);
  });

  it('fails the run on a failing item, or skips it when told to carry on', async () => {
    fetchBody = JSON.stringify({ urls: ['a.test/', 'b.fail/', 'c.test/'] });
    const build = (carryOn: boolean) => {
      const fetchNode = http('fetch', { method: 'GET' });
      const each = loop('each', '{{ nodes.fetch.body.urls }}', { continueOnError: carryOn });
      const call = http('call', { url: 'https://{{ item }}' });
      const after = email('after', { subject: 'after {{ nodes.each.count }}' });
      return {
        nodes: [fetchNode, each, call, after],
        edges: [
          link(WORKFLOW_TRIGGER_ID, fetchNode.id, 'out'),
          link(fetchNode.id, each.id),
          link(each.id, call.id, 'each'),
          link(each.id, after.id, 'done'),
        ],
      };
    };
    const strict = await workflow('Strict', onEvents(['content.created']), build(false));
    const lenient = await workflow('Lenient', onEvents(['content.created']), build(true));
    await page('Calls');
    await engine.idle();

    const [strictRun] = await h.runsOf(strict.id);
    expect(strictRun?.status).toBe('failed');
    expect(strictRun?.error).toMatch(/^Item 2: .*HTTP 500/);

    const [lenientRun] = await h.runsOf(lenient.id);
    expect(lenientRun?.status).toBe('succeeded');
    const results = (
      lenientRun?.state.outputs.each?.value as { results: Array<{ error?: string }> }
    ).results;
    expect(results.map((result) => Boolean(result.error))).toEqual([false, true, false]);
    expect(mails.map((mail) => mail.subject)).toEqual(['after 3']);
  });
});

describe('switches', () => {
  const route = (key: string, field: string, values: string[]) =>
    ({
      ...base(key),
      kind: 'switch',
      field,
      cases: values.map((value, index) => ({
        id: `case_${index + 1}`,
        label: '',
        operator: 'equals',
        value,
      })),
    }) as WorkflowNode;

  it('takes the first case that holds, or otherwise', async () => {
    const pick = route('pick', 'content.fields.category', ['news', 'blog', 'news']);
    const news = email('news', { subject: 'news via {{ nodes.pick.case }}' });
    const blog = email('blog', { subject: 'blog' });
    const other = email('other', { subject: 'other: {{ nodes.pick.label }}' });
    const wf = await workflow('Route', onEvents(['content.created']), {
      nodes: [pick, news, blog, other],
      edges: [
        link(WORKFLOW_TRIGGER_ID, pick.id, 'out'),
        link(pick.id, news.id, 'case_1'),
        link(pick.id, blog.id, 'case_2'),
        link(pick.id, other.id, 'case_3'),
        link(pick.id, other.id, 'default'),
      ],
    });
    await page('A', { category: 'news' });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['news via case_1']);

    mails.length = 0;
    await page('B', { category: 'recipes' });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['other: Otherwise']);
    const [latest] = await h.runsOf(wf.id);
    expect(latest?.log.find((entry) => entry.key === 'pick')?.detail).toEqual({ case: 'default' });
  });

  it('refuses a line from a case the switch does not have', async () => {
    const pick = route('pick', 'content.title', ['x']);
    const after = email('after');
    await expect(
      workflow('Broken', onEvents(['content.created']), {
        nodes: [pick, after],
        edges: [link(WORKFLOW_TRIGGER_ID, pick.id, 'out'), link(pick.id, after.id, 'case_9')],
      }),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([
        expect.objectContaining({ key: 'plugins.workflows.edge.portUnknown' }),
      ]),
    });
  });
});

describe('counted and repeated loops', () => {
  const loop = (key: string, extra: Record<string, unknown>) =>
    ({
      ...base(key),
      kind: 'loop',
      mode: 'items',
      items: '',
      count: '',
      until: { match: 'all', rules: [] },
      maxItems: 50,
      ...extra,
    }) as WorkflowNode;

  it('repeats a number of times, from a placeholder too', async () => {
    const times = loop('times', { mode: 'count', count: '{{ content.fields.category }}' });
    const tell = email('tell', { subject: 'pass {{ item }} of {{ loop.count }}' });
    const after = email('after', { subject: '{{ nodes.times.count }} passes' });
    await workflow('Count', onEvents(['content.created']), {
      nodes: [times, tell, after],
      edges: [
        link(WORKFLOW_TRIGGER_ID, times.id, 'out'),
        link(times.id, tell.id, 'each'),
        link(times.id, after.id, 'done'),
      ],
    });
    await page('Three', { category: '3' });
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual([
      'pass 0 of 3',
      'pass 1 of 3',
      'pass 2 of 3',
      '3 passes',
    ]);
  });

  it('fails on a count that is not a whole number', async () => {
    const times = loop('times', { mode: 'count', count: '{{ content.title }}' });
    const tell = email('tell');
    const wf = await workflow('Bad count', onEvents(['content.created']), {
      nodes: [times, tell],
      edges: [link(WORKFLOW_TRIGGER_ID, times.id, 'out'), link(times.id, tell.id, 'each')],
    });
    await page('many');
    await engine.idle();
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('"many" is not a number of times to repeat');
  });

  it('repeats until its rules hold after a pass, or its limit', async () => {
    const build = (value: string) => {
      const again = loop('again', {
        mode: 'until',
        maxItems: 4,
        until: {
          match: 'all',
          rules: [{ field: 'loop.index', operator: 'equals', value }],
        },
      });
      const tell = email('tell', { subject: 'pass {{ loop.index }}' });
      const after = email('after', { subject: 'met {{ nodes.again.met }}' });
      return {
        nodes: [again, tell, after],
        edges: [
          link(WORKFLOW_TRIGGER_ID, again.id, 'out'),
          link(again.id, tell.id, 'each'),
          link(again.id, after.id, 'done'),
        ],
      };
    };
    await workflow('Until', onEvents(['content.created']), build('1'));
    await page('Go');
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual(['pass 0', 'pass 1', 'met true']);

    for (const row of await workflowRepos(repos).workflows.listBySpace(spaceId)) {
      await workflowRepos(repos).workflows.delete(row.id);
    }
    mails.length = 0;
    await workflow('Never', onEvents(['content.created']), build('99'));
    await page('Go again');
    await engine.idle();
    expect(mails.map((mail) => mail.subject)).toEqual([
      'pass 0',
      'pass 1',
      'pass 2',
      'pass 3',
      'met false',
    ]);
  });
});

describe('stop nodes', () => {
  const stop = (key: string, outcome: 'succeeded' | 'failed', message = '') =>
    ({ ...base(key), kind: 'stop', outcome, message }) as WorkflowNode;

  it('ends the whole run, other branches included', async () => {
    const end = stop('end', 'succeeded', 'Nothing more for {{ content.title }}');
    const first = email('first', { subject: 'first' });
    const later = email('later', { subject: 'later' });
    const wf = await workflow('Stops', onEvents(['content.created']), {
      nodes: [first, end, later],
      edges: [
        link(WORKFLOW_TRIGGER_ID, first.id, 'out'),
        link(WORKFLOW_TRIGGER_ID, end.id, 'out'),
        link(first.id, later.id),
      ],
    });
    await page('Doc');
    await engine.idle();
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    expect(mails.map((mail) => mail.subject)).toEqual(['first']);
    expect(run?.log.find((entry) => entry.key === 'end')?.message).toBe('Nothing more for Doc');
  });

  it('fails the run with its message, from inside a loop that skips failures too', async () => {
    const each = {
      ...base('each'),
      kind: 'loop',
      mode: 'count',
      items: '',
      count: '3',
      until: { match: 'all', rules: [] },
      maxItems: 50,
      continueOnError: true,
    } as WorkflowNode;
    const end = stop('end', 'failed', 'Gave up at {{ loop.index }}');
    const after = email('after');
    const wf = await workflow('Fails', onEvents(['content.created']), {
      nodes: [each, end, after],
      edges: [
        link(WORKFLOW_TRIGGER_ID, each.id, 'out'),
        link(each.id, end.id, 'each'),
        link(each.id, after.id, 'done'),
      ],
    });
    await page('Looped');
    await engine.idle();
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('Gave up at 0');
    expect(mails).toEqual([]);
  });
});
