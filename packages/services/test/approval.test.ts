import { runAsActor } from '@manablox/core/node';
import type { UserRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let author: UserRow;
let editor: UserRow;
let owner: UserRow;
let root: UserRow;

const as = (user: UserRow) => ({ kind: 'user' as const, id: user.id, label: user.email });
const actorOf = (user: UserRow, role: string) => ({ userId: user.id, roles: ['editor', role] });

beforeAll(async () => {
  ctx = await createServiceContext('approvals', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      ...TEST_TYPES,
      { name: 'post', requiresApproval: true, fields: [{ name: 'body', type: 'string' }] },
    ],
  });
  const make = (name: string, role: 'editor' | 'superadmin' = 'editor') =>
    ctx.repos.users.create({ name, email: `${name}@example.com`, role, passwordHash: 'x' });
  author = await make('author');
  editor = await make('editor');
  owner = await make('owner');
  root = await make('root', 'superadmin');
  await ctx.repos.users.grant(author.id, ctx.spaceId, 'author');
  await ctx.repos.users.grant(editor.id, ctx.spaceId, 'editor');
  await ctx.repos.users.grant(owner.id, ctx.spaceId, 'owner');
});
afterAll(async () => {
  await ctx?.close();
});

const post = (title: string) =>
  runAsActor(as(author), () =>
    ctx.content.create(
      { spaceId: ctx.spaceId, typeId: ctx.ids.post as string, locale: 'en', title, fields: {} },
      actorOf(author, 'author'),
    ),
  );

const titles = async (user: UserRow, kind: string) =>
  (await ctx.notifications.list(user.id, { kinds: [kind as never] })).items.map((row) => row.title);

describe('asking for approval', () => {
  it('opens one request and tells everyone who can publish the type, superadmins included', async () => {
    const row = await post('First');
    const approval = await runAsActor(as(author), () =>
      ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'), 'Please'),
    );
    expect(approval).toMatchObject({
      status: 'pending',
      requestedBy: author.id,
      requestedByLabel: 'author@example.com',
      requestNote: 'Please',
      contentVersion: row.version,
    });

    const expected = '"First" is waiting for your approval';
    expect(await titles(editor, 'content.approvalRequested')).toEqual([expected]);
    expect(await titles(owner, 'content.approvalRequested')).toEqual([expected]);
    expect(await titles(root, 'content.approvalRequested')).toEqual([expected]);
    expect(await titles(author, 'content.approvalRequested')).toEqual([]);

    const state = await ctx.approvals.state(ctx.spaceId, row.id);
    expect(state.required).toBe(true);
    expect(state.pending?.id).toBe(approval.id);

    const queue = await ctx.approvals.pending(ctx.spaceId);
    expect(queue.items.map((entry) => entry.content.title)).toContain('First');
    expect(queue.total).toBe(queue.items.length);
    expect((await ctx.approvals.pending(ctx.spaceId, [ctx.ids.article as string])).items).toEqual(
      [],
    );
  });

  it('refuses a second open request, and any request on a type without review', async () => {
    const row = await post('Twice');
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    await expect(
      ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author')),
    ).rejects.toMatchObject({ key: 'content.approval.alreadyPending' });

    const article = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Plain',
      fields: {},
    });
    await expect(
      ctx.approvals.request(ctx.spaceId, article.id, actorOf(author, 'author')),
    ).rejects.toMatchObject({ key: 'content.approval.notRequired' });
  });

  it('lets only the requester withdraw, and tells the reviewers', async () => {
    const row = await post('Withdrawn');
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    await expect(
      ctx.approvals.withdraw(ctx.spaceId, row.id, actorOf(editor, 'editor')),
    ).rejects.toMatchObject({ key: 'content.approval.notRequester' });

    const withdrawn = await runAsActor(as(author), () =>
      ctx.approvals.withdraw(ctx.spaceId, row.id, actorOf(author, 'author')),
    );
    expect(withdrawn.status).toBe('withdrawn');
    expect(await titles(editor, 'content.approvalWithdrawn')).toEqual([
      '"Withdrawn" no longer needs your approval',
    ]);
    expect((await ctx.approvals.state(ctx.spaceId, row.id)).pending).toBeNull();
  });
});

describe('deciding', () => {
  it('approving publishes the document and tells the author', async () => {
    const row = await post('Approved');
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));

    const { approval, content } = await runAsActor(as(editor), () =>
      ctx.approvals.approve(ctx.spaceId, row.id, actorOf(editor, 'editor'), 'Nice'),
    );
    expect(approval).toMatchObject({
      status: 'approved',
      decidedBy: editor.id,
      decidedByLabel: 'editor@example.com',
      decisionNote: 'Nice',
    });
    expect(content.status).toBe('published');
    expect((await ctx.repos.content.findById(row.id, true))?.title).toBe('Approved');
    expect(await titles(author, 'content.approved')).toEqual([
      '"Approved" was approved and published',
    ]);

    const history = await ctx.audit.forTarget(ctx.spaceId, 'content', row.id);
    expect(history.items.map((entry) => entry.action)).toEqual([
      'content.approve',
      'content.publish',
      'content.requestApproval',
      'content.create',
    ]);
  });

  it('sending back keeps the document a draft and carries the note to the author', async () => {
    const row = await post('Rejected');
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    const rejected = await runAsActor(as(owner), () =>
      ctx.approvals.reject(ctx.spaceId, row.id, actorOf(owner, 'owner'), 'Too short'),
    );
    expect(rejected.status).toBe('rejected');
    expect((await ctx.repos.content.findById(row.id))?.status).toBe('draft');
    const inbox = await ctx.notifications.list(author.id, { kinds: ['content.rejected'] });
    expect(inbox.items[0]).toMatchObject({
      title: '"Rejected" was sent back',
      body: 'owner@example.com sent it back: Too short',
      url: `/content/${row.id}`,
    });

    // Nothing is open to decide.
    await expect(
      ctx.approvals.approve(ctx.spaceId, row.id, actorOf(owner, 'owner')),
    ).rejects.toMatchObject({ key: 'content.approval.notPending' });

    // A new request; the earlier one stays as history.
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    const state = await ctx.approvals.state(ctx.spaceId, row.id);
    expect(state.history.map((entry) => entry.status)).toEqual(['pending', 'rejected']);
    expect(state.latest?.status).toBe('pending');
  });

  it('a plain publish by someone who can closes the open request as approved', async () => {
    const row = await post('Direct');
    await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    await runAsActor(as(editor), () =>
      ctx.content.publish(ctx.spaceId, row.id, actorOf(editor, 'editor')),
    );

    const state = await ctx.approvals.state(ctx.spaceId, row.id);
    expect(state.pending).toBeNull();
    expect(state.latest).toMatchObject({ status: 'approved', decidedBy: editor.id });
    expect(await titles(author, 'content.approved')).toContain('"Direct" was published');
  });

  it('deleting the document takes its requests with it', async () => {
    const row = await post('Gone');
    const approval = await ctx.approvals.request(ctx.spaceId, row.id, actorOf(author, 'author'));
    await ctx.content.delete(ctx.spaceId, row.id);
    expect(await ctx.repos.approvals.findById(approval.id)).toBeNull();
    expect((await ctx.approvals.pending(ctx.spaceId)).items.map((entry) => entry.id)).not.toContain(
      approval.id,
    );
  });
});
