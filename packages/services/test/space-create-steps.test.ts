import { definePlugin } from '@manablox/core';
import type { TransactionRepositories } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';

let ctx: ServiceContext;
const seen: string[] = [];
let failWith: string | null = null;
let refuse = false;

const notes = definePlugin({
  name: 'notes',
  spaceCreate: {
    async apply({ space }, { note }: { note: string }) {
      if (refuse) throw new Error('Refused.');
      seen.push(`apply ${note} ${space.url}`);
    },
    async afterCommit({ space, actorId }, { note }: { note: string }) {
      // Committed: another connection sees the space and what `committed` wrote.
      const row = await ctx.repos.spaces.findById(space.id);
      seen.push(`after ${note} ${row?.description ?? 'none'} ${actorId}`);
      if (failWith) throw new Error(failWith);
      return note === 'warn' ? 'Check the notes.' : null;
    },
  },
});
const quiet = definePlugin({
  name: 'quiet',
  spaceCreate: { apply: async () => void seen.push('quiet') },
});

let seq = 0;
const input = (plugins: Record<string, unknown>) => {
  const name = `steps-${++seq}`;
  return { name, machineName: name, url: `http://${name}.test`, plugins };
};

beforeAll(async () => {
  ctx = await createServiceContext('space_create_steps', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
    config: { plugins: [notes, quiet] },
  });
});
afterAll(async () => {
  await ctx?.close();
});
beforeEach(() => {
  seen.length = 0;
  failWith = null;
  refuse = false;
});

describe("the plugins' after-commit steps", () => {
  it('run after the transaction and `committed`, and report their sentences', async () => {
    const space = await ctx.spaces.create(
      input({ notes: { note: 'warn' }, quiet: {} }),
      null,
      async () => {
        seen.push('fill');
      },
      async (created) => {
        seen.push('committed');
        await ctx.repos.spaces.update(created.id, { description: 'described' });
      },
    );
    expect(seen).toEqual([
      'fill',
      `apply warn ${space.url}`,
      'quiet',
      'committed',
      'after warn described null',
    ]);
    expect(space.warnings).toEqual(['Check the notes.']);
  });

  it('turn a throw into a warning and keep the space', async () => {
    failWith = 'The notes service is down.';
    const data = input({ notes: { note: 'plain' } });
    const space = await ctx.spaces.create(data, null);
    expect(space.warnings).toEqual([
      'The notes plugin could not finish setting up the space: The notes service is down.',
    ]);
    expect(await ctx.repos.spaces.findById(space.id)).toMatchObject({
      machineName: data.machineName,
    });
  });

  it('report nothing without data for them', async () => {
    const space = await ctx.spaces.create(input({}), null);
    expect(space.warnings).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('see the types a plan adds in the create, and a refusal leaves none in the registry', async () => {
    const plan = { types: [{ name: 'note', kind: 'content' as const, fields: [] }] };
    const fill = (space: { id: string }, repos: TransactionRepositories) =>
      ctx.contentTypes.using(repos).applyPlan(space.id, plan);
    const typed = await ctx.spaces.create(input({ notes: { note: 'typed' } }), null, fill);
    const names = ctx.manablox.contentTypes.forSpace(typed.id).map((type) => type.name);
    expect(names).toContain('note');

    refuse = true;
    const data = input({ notes: { note: 'refused' } });
    await expect(ctx.spaces.create(data, null, fill)).rejects.toThrow('Refused.');
    expect(await ctx.repos.spaces.findByMachineName(data.machineName)).toBeNull();
    const notes = ctx.manablox.contentTypes.all.filter((type) => type.name === 'note');
    expect(notes.map((type) => type.spaceId)).toEqual([typed.id]);
  });
});
