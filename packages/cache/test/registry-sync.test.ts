import { type ContentTypeDefinition, defineContentType, type ManabloxConfig } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachRegistrySync, type RegistrySyncSource } from '../src/index.js';

/** Stands in for the `content_types` table both processes share. */
class Table implements RegistrySyncSource {
  types: ContentTypeDefinition[] = [];
  loads = 0;
  spaceLoads: Array<string | null> = [];

  add(name: string, spaceId: string | null = null): void {
    this.types = [
      ...this.types,
      { ...defineContentType({ name, label: name, spaceId, fields: [] }), source: 'runtime' },
    ];
  }

  async load(): Promise<ContentTypeDefinition[]> {
    this.loads++;
    return this.types;
  }

  async loadSpace(spaceId: string | null): Promise<ContentTypeDefinition[]> {
    this.spaceLoads.push(spaceId);
    return this.types.filter((type) => type.spaceId === spaceId);
  }

  async fingerprint(): Promise<string> {
    return this.types.map((type) => type.id).join(',');
  }
}

const instances: Manablox[] = [];

function instance(cache: ManabloxConfig['cache']): Manablox {
  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: [],
    contentTypes: [],
    cache,
    logging: { adapters: [{ name: 'discard', stream: { write() {} } }] },
  } as unknown as ManabloxConfig);
  instances.push(manablox);
  return manablox;
}

/** What the admin does in the process that saves a type. */
async function save(manablox: Manablox, table: Table, name: string): Promise<void> {
  table.add(name);
  await manablox.reload(await table.load());
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
});

describe('registry sync without Redis', () => {
  it('picks up a type another process saved', async () => {
    const table = new Table();
    const management = instance({ syncInterval: 0 });
    const publicApi = instance({ syncInterval: 0.02 });
    await attachRegistrySync(publicApi, table);

    await save(management, table, 'portfolio_page');

    await vi.waitFor(() =>
      expect(publicApi.contentTypes.tryGetByName('portfolio_page')).toBeDefined(),
    );
  });

  it('does not reload while nothing changed', async () => {
    const table = new Table();
    const publicApi = instance({ syncInterval: 0.01 });
    await attachRegistrySync(publicApi, table);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(table.loads).toBe(0);
  });

  it('does not check at all with an interval of 0', async () => {
    const table = new Table();
    const fingerprint = vi.spyOn(table, 'fingerprint');
    await attachRegistrySync(instance({ syncInterval: 0 }), table);
    expect(fingerprint).not.toHaveBeenCalled();
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('registry sync over Redis', () => {
  it('reloads every other process as soon as one saves', async () => {
    const table = new Table();
    const management = instance({ redisUrl, syncInterval: 60 });
    const publicApi = instance({ redisUrl, syncInterval: 60 });
    await attachRegistrySync(management, table);
    await attachRegistrySync(publicApi, table);
    // Subscribing is asynchronous; an announcement before it would be missed.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await save(management, table, 'portfolio_page');

    await vi.waitFor(() =>
      expect(publicApi.contentTypes.tryGetByName('portfolio_page')).toBeDefined(),
    );
    // The sender does not reload its own announcement, and the receiver does not echo it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(table.loads).toBe(2);
  });

  it('reloads only the space another process saved a type of', async () => {
    const table = new Table();
    const management = instance({ redisUrl, syncInterval: 60 });
    const publicApi = instance({ redisUrl, syncInterval: 60 });
    await attachRegistrySync(management, table);
    await attachRegistrySync(publicApi, table);
    await new Promise((resolve) => setTimeout(resolve, 200));

    table.add('portfolio_page', 'space-1');
    await management.reloadSpace('space-1', await table.loadSpace('space-1'));

    await vi.waitFor(() =>
      expect(publicApi.contentTypes.tryGetByName('portfolio_page', 'space-1')).toBeDefined(),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(table.loads).toBe(0);
    expect(table.spaceLoads).toEqual(['space-1', 'space-1']);
  });
});
