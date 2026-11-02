import { randomUUID } from 'node:crypto';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_events', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const name = () => `ev-${++counter}-${randomUUID().slice(0, 8)}`;

const freshSpace = async () => {
  const machineName = name();
  return ctx.spaces.create({ name: machineName, machineName, url: 'http://ev.test' }, null);
};

/** Events written after `mark`, oldest first. */
const since = (mark: number) => ctx.repos.controlEvents.listAfter(mark, 1000);

const mark = () => ctx.repos.controlEvents.latestSeq();

describe('site domain events', () => {
  it('records domains added, renamed and removed', async () => {
    const space = await freshSpace();
    const start = await mark();
    const row = await ctx.website.domains.create(space.id, { hostname: `${name()}.example.test` });
    const renamed = await ctx.website.domains.update(space.id, row.id, {
      hostname: `${name()}.example.test`,
    });
    await ctx.website.domains.update(space.id, row.id, { redirectToPrimary: true });
    await ctx.website.domains.delete(space.id, row.id);

    const payload = (hostname: string) => ({
      spaceId: space.id,
      environmentId: row.environmentId,
      environment: 'production',
      domainId: row.id,
      hostname,
      kind: 'site',
      locale: null,
    });
    expect((await since(start)).map((event) => [event.type, event.payload])).toEqual([
      ['domain.added', payload(row.hostname)],
      ['domain.removed', payload(row.hostname)],
      ['domain.added', payload(renamed.hostname)],
      ['domain.removed', payload(renamed.hostname)],
    ]);
  });
});
