import { HookBus, type ManabloxHooks } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { describe, expect, it } from 'vitest';
import { promoteFirstUser } from '../src/index.js';

/** One account, three spaces: `s2` refused by a hook, `s3` already the account's as editor. */
function setup() {
  const grants: Array<[string, string, string]> = [];
  const events: unknown[] = [];
  const warnings: unknown[] = [];
  const hooks = new HookBus<ManabloxHooks>();
  hooks.on('member:beforeGrant', (payload) => {
    if (payload.spaceId === 's2') throw new Error('refused');
  });
  const tx = {
    users: { grant: async (...args: [string, string, string]) => void grants.push(args) },
    limitCounts: { seats: async () => 4 },
  };
  const repos = {
    users: {
      count: async () => 1,
      findById: async () => ({ id: 'u1', email: 'first@example.test', role: 'editor' }),
      setRole: async () => {},
      findSpaceRole: async (_userId: string, spaceId: string) =>
        spaceId === 's3' ? 'editor' : null,
    },
    spaces: { list: async () => [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
    audit: { record: async () => {} },
    transaction: async (fn: (repos: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Repositories;
  const manablox = {
    hooks,
    logger: { info: () => {}, warn: (...args: unknown[]) => void warnings.push(args) },
    controls: {
      emit: async (type: string, scope: unknown, payload: unknown, options: unknown) =>
        void events.push({ type, scope, payload, tx: (options as { tx: unknown }).tx === tx }),
    },
  } as unknown as Manablox;
  return { manablox, repos, grants, events, warnings };
}

describe('promoteFirstUser', () => {
  it('grants every space through member:beforeGrant and emits seat.changed for new members', async () => {
    const { manablox, repos, grants, events, warnings } = setup();
    await promoteFirstUser(manablox, repos, 'u1');

    expect(grants).toEqual([
      ['u1', 's1', 'owner'],
      ['u1', 's3', 'owner'],
    ]);
    expect(warnings).toHaveLength(1);
    expect(events).toEqual([
      {
        type: 'seat.changed',
        scope: { kind: 'space', id: 's1' },
        payload: { spaceId: 's1', change: 'added', userIds: ['u1'], members: 4 },
        tx: true,
      },
    ]);
  });
});
