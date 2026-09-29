import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workflowRepos } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';

let database: TestDatabase;
let handle: DatabaseHandle;
let repos: Repositories;
let spaceId: string;

beforeAll(async () => {
  database = await createTestDatabase('workflow_live', { plugins: [workflowsPlugin()] });
  handle = await createDatabase({ url: database.url, max: 4 });
  repos = createRepositories(handle, new ContentTypeRegistry(new FieldTypeRegistry()));
  spaceId = (await repos.spaces.create({ name: 'Live', machineName: 'live', url: 'http://l.test' }))
    .id;
});
afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

const trigger = { kind: 'event' as const, events: [], typeIds: [], locales: [] };

describe('live-workflow listeners', () => {
  it('hears a change after commit only', async () => {
    const heard: string[] = [];
    const off = workflowRepos(repos).workflows.onLiveChange((id) => heard.push(id));
    try {
      const definition = {
        name: 'Live',
        description: null,
        trigger,
        abortTriggers: [],
        nodes: [],
        edges: [],
      };
      await repos.transaction(async (tx) => {
        const { workflows } = workflowRepos(tx);
        const wf = await workflows.create({ spaceId, ...definition });
        await workflows.publish(wf.id, { definition });
        expect(heard).toEqual([]);
      });
      expect(heard).toEqual([spaceId]);

      await expect(
        repos.transaction(async (tx) => {
          const { workflows } = workflowRepos(tx);
          const wf = await workflows.create({ spaceId, ...definition });
          await workflows.publish(wf.id, { definition });
          throw new Error('undo');
        }),
      ).rejects.toThrow('undo');
      expect(heard).toEqual([spaceId]);
    } finally {
      off();
    }
  });
});
