import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  migrationStatus,
  type Repositories,
  runMigrations,
} from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { helloRepos } from '../fixtures/plugins/hello/db.js';
import { helloPlugin } from '../fixtures/plugins/hello/plugin.js';

describe('the hello plugin', () => {
  let database: TestDatabase;
  let handle: DatabaseHandle;
  let repos: Repositories;
  let seq = 0;

  const space = (bound: Repositories = repos) => {
    const name = `hello-${++seq}`;
    return bound.spaces.create({ name, machineName: name, url: 'http://hello.test' });
  };

  beforeAll(async () => {
    database = await createTestDatabase('hello', { plugins: [helloPlugin()] });
    handle = await createDatabase({ url: database.url, max: 4 });
    repos = createRepositories(handle, new ContentTypeRegistry(new FieldTypeRegistry()));
  });
  afterAll(async () => {
    await handle?.close();
    await database?.drop();
  });

  it('ships migrations that are applied and idempotent', async () => {
    await runMigrations(handle, [helloPlugin()]);
    const status = await migrationStatus(handle, [helloPlugin()]);
    expect(status.plugins).toEqual([
      { id: 'hello', latest: '0000_hello-greetings', applied: '0000_hello-greetings', pending: 0 },
    ]);
  });

  it('stores greetings per environment', async () => {
    const { id: spaceId } = await space();
    const { greetings } = helloRepos(repos);
    const row = await greetings.create({ spaceId }, 'Hello');
    expect(await greetings.list(spaceId)).toEqual([row]);
    expect(await greetings.update(row.id, 'Hi')).toMatchObject({ message: 'Hi' });
    expect(await greetings.countBySpace(spaceId)).toBe(1);
    expect(await greetings.remove(row.id)).toBe(true);
    expect(await greetings.findById(row.id)).toBeNull();
  });

  it('writes inside a core transaction', async () => {
    let greetingId = '';
    await expect(
      repos.transaction(async (tx) => {
        const { id: spaceId } = await space(tx);
        greetingId = (await helloRepos(tx).greetings.create({ spaceId }, 'Hello')).id;
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await helloRepos(repos).greetings.findById(greetingId)).toBeNull();
  });

  it('drops greetings with their space', async () => {
    const { id: spaceId } = await space();
    const { greetings } = helloRepos(repos);
    const row = await greetings.create({ spaceId }, 'Bye');
    await repos.spaces.delete(spaceId);
    expect(await greetings.findById(row.id)).toBeNull();
  });
});
