import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('content_approval');
  otherSpaceId = (
    await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'http://o.test' })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const doc = (type: 'page' | 'folder' = 'page', spaceId?: string) => {
  const n = ++counter;
  if (!spaceId) return makeNode(ctx, { title: `Doc ${n}`, slug: `doc-${n}`, type });
  return ctx.repos.content.create({
    spaceId,
    typeId: ctx.types[type].id,
    locale: 'en',
    title: `Doc ${n}`,
    slug: `doc-${n}`,
    fields: {},
    hasSlug: ctx.types[type].hasSlug,
  });
};

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

const request = async (
  content: { id: string; typeId: string },
  data: { spaceId?: string; note?: string } = {},
) => {
  const row = await ctx.repos.approvals.request({
    spaceId: data.spaceId ?? ctx.spaceId,
    contentId: content.id,
    typeId: content.typeId,
    requestedBy: null,
    requestedByLabel: 'Sam',
    requestNote: data.note,
  });
  await pause();
  return row;
};

const decide = (id: string, status: 'approved' | 'rejected' | 'withdrawn') =>
  ctx.repos.approvals.decide(id, { status, decidedBy: null, decidedByLabel: 'Kim' });

describe('approvals', () => {
  it('stores a request as pending with its note and version', async () => {
    const content = await doc();
    const row = await ctx.repos.approvals.request({
      spaceId: ctx.spaceId,
      contentId: content.id,
      typeId: content.typeId,
      requestedBy: null,
      requestedByLabel: 'Sam',
      requestNote: 'please',
      contentVersion: 3,
    });
    expect(row).toMatchObject({
      status: 'pending',
      requestNote: 'please',
      contentVersion: 3,
      decidedAt: null,
    });
    expect((await ctx.repos.approvals.findById(row.id))?.id).toBe(row.id);
  });

  it('decide records the outcome; an unknown id is not found', async () => {
    const content = await doc();
    const row = await request(content);
    const decided = await ctx.repos.approvals.decide(row.id, {
      status: 'rejected',
      decidedBy: null,
      decidedByLabel: 'Kim',
      decisionNote: 'typos',
    });
    expect(decided).toMatchObject({
      status: 'rejected',
      decidedByLabel: 'Kim',
      decisionNote: 'typos',
    });
    expect(decided.decidedAt).toBeInstanceOf(Date);
    await expect(decide(crypto.randomUUID(), 'approved')).rejects.toMatchObject({
      key: 'content.approval.notPending',
      kind: 'not_found',
    });
  });

  it('finds the pending and the latest request of a document', async () => {
    const content = await doc();
    expect(await ctx.repos.approvals.findPendingByContent(content.id)).toBeNull();
    expect(await ctx.repos.approvals.findLatestByContent(content.id)).toBeNull();

    const first = await request(content);
    await decide(first.id, 'approved');
    expect(await ctx.repos.approvals.findPendingByContent(content.id)).toBeNull();
    expect((await ctx.repos.approvals.findLatestByContent(content.id))?.id).toBe(first.id);

    const second = await request(content);
    expect((await ctx.repos.approvals.findPendingByContent(content.id))?.id).toBe(second.id);
    expect((await ctx.repos.approvals.findLatestByContent(content.id))?.id).toBe(second.id);
  });

  it('listByContent returns the history newest first up to the limit', async () => {
    const content = await doc();
    const rows = [];
    for (let index = 0; index < 3; index++) {
      const row = await request(content);
      await decide(row.id, 'withdrawn');
      rows.push(row);
    }
    const history = await ctx.repos.approvals.listByContent(content.id);
    expect(history.map((row) => row.id)).toEqual(rows.map((row) => row.id).reverse());
    expect((await ctx.repos.approvals.listByContent(content.id, 2)).map((row) => row.id)).toEqual([
      rows[2]?.id,
      rows[1]?.id,
    ]);
  });

  it('drops the requests with their document', async () => {
    const content = await doc();
    const row = await request(content);
    await ctx.repos.content.deleteReturning(content.id);
    expect(await ctx.repos.approvals.findById(row.id)).toBeNull();
  });
});

describe('approvals.pagePendingBySpace', () => {
  it('pages the open requests of one space oldest first, with the document', async () => {
    const space = await ctx.repos.spaces.create({
      name: 'Queue',
      machineName: 'queue',
      url: 'http://q.test',
    });
    const docs = await Promise.all([
      doc('page', space.id),
      doc('page', space.id),
      doc('page', space.id),
      doc('page', space.id),
    ]);
    const open = [];
    for (const content of docs.slice(0, 3))
      open.push(await request(content, { spaceId: space.id }));
    const closed = await request(docs[3] as (typeof docs)[number], { spaceId: space.id });
    await decide(closed.id, 'approved');
    await request(await doc('page', otherSpaceId), { spaceId: otherSpaceId });

    const first = await ctx.repos.approvals.pagePendingBySpace(space.id, null, {
      limit: 2,
      offset: 0,
    });
    expect(first).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(first.items.map((row) => row.id)).toEqual([open[0]?.id, open[1]?.id]);
    expect(first.items[0]?.content).toMatchObject({
      id: docs[0]?.id,
      title: docs[0]?.title,
      locale: 'en',
      typeId: docs[0]?.typeId,
    });

    const rest = await ctx.repos.approvals.pagePendingBySpace(space.id, null, {
      limit: 2,
      offset: 2,
    });
    expect(rest.items.map((row) => row.id)).toEqual([open[2]?.id]);

    const past = await ctx.repos.approvals.pagePendingBySpace(space.id, null, {
      limit: 2,
      offset: 10,
    });
    expect(past).toMatchObject({ items: [], total: 3 });
  });

  it('narrows by type ids; an empty list means no readable type', async () => {
    const space = await ctx.repos.spaces.create({
      name: 'Types',
      machineName: 'types',
      url: 'http://t.test',
    });
    const page = await request(await doc('page', space.id), { spaceId: space.id });
    await request(await doc('folder', space.id), { spaceId: space.id });

    const pages = await ctx.repos.approvals.pagePendingBySpace(space.id, [ctx.types.page.id]);
    expect(pages.items.map((row) => row.id)).toEqual([page.id]);
    expect(pages.total).toBe(1);
    expect(await ctx.repos.approvals.pagePendingBySpace(space.id, [])).toEqual({
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
    });
    expect((await ctx.repos.approvals.pagePendingBySpace(space.id)).total).toBe(2);
  });
});
