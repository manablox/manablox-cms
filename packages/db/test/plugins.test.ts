import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentTypeRegistry, definePlugin, FieldTypeRegistry } from '@manablox/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/client.js';
import { migrationStatus, runMigrations } from '../src/migrate.js';
import { migrateSqliteToPostgres } from '../src/migrate-db.js';
import {
  createRepositories,
  databaseContextOf,
  type Repositories,
} from '../src/repositories/index.js';
import { createTestDatabase, TEST_DIALECT, type TestDatabase } from '../src/testing.js';
import { folder, NotesRepository, notesPlugin } from './fixtures/plugin-notes/index.js';

const JOURNAL = '__manablox_migrations_acme.notes';

const registry = () => new ContentTypeRegistry(new FieldTypeRegistry());

async function rows<T>(handle: DatabaseHandle, query: string): Promise<T[]> {
  return handle.dialect.rows<T>(handle.db, sql.raw(query));
}

/** Journal rows of the core migrations or of the fixture plugin. */
async function journalCount(handle: DatabaseHandle, journal: string): Promise<number> {
  const table =
    handle.kind === 'sqlite' ? `"${journal}"` : `drizzle."${journal.replaceAll('"', '""')}"`;
  const [row] = await rows<{ n: number }>(handle, `select count(*) as n from ${table}`);
  return Number(row?.n);
}

async function hasTable(handle: DatabaseHandle, name: string): Promise<boolean> {
  const query =
    handle.kind === 'sqlite'
      ? `select 1 as found from sqlite_master where type = 'table' and name = '${name}'`
      : `select 1 as found from pg_tables where schemaname = 'public' and tablename = '${name}'`;
  return (await rows(handle, query)).length > 0;
}

/** A copy of the fixture's Postgres or SQLite folder holding only its first migration. */
function firstMigrationOnly(dialect: DatabaseHandle['kind']): string {
  const source = folder(dialect === 'sqlite' ? 'migrations-sqlite' : 'migrations');
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
  const copy = mkdtempSync(join(tmpdir(), 'manablox-plugin-'));
  mkdirSync(join(copy, 'meta'));
  const entries = journal.entries.slice(0, 1);
  writeFileSync(join(copy, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  copyFileSync(join(source, '0000_notes.sql'), join(copy, '0000_notes.sql'));
  return copy;
}

describe('plugin migrations', () => {
  let database: TestDatabase;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    database = await createTestDatabase('plugin_migrations', { empty: true });
    handle = await createDatabase({ url: database.url, max: 2 });
  });
  afterAll(async () => {
    await handle?.close();
    await database?.drop();
  });

  it('reports every migration pending on an empty database', async () => {
    const status = await migrationStatus(handle, [notesPlugin()]);
    expect(status).toMatchObject({ applied: null, pending: expect.any(Number) });
    expect(status.pending).toBeGreaterThan(0);
    expect(status.plugins).toEqual([
      { id: 'acme.notes', latest: '0001_pinned', applied: null, pending: 2 },
    ]);
  });

  it('migrates a plugin after core, into its own journal, and reports it per plugin', async () => {
    const first = firstMigrationOnly(handle.kind);
    try {
      // Its foreign keys need the core tables.
      await runMigrations(handle, [notesPlugin(first)]);
    } finally {
      rmSync(first, { recursive: true, force: true });
    }
    expect(await hasTable(handle, 'notes_items')).toBe(true);
    expect(await journalCount(handle, JOURNAL)).toBe(1);
    const status = await migrationStatus(handle);
    expect(status).toMatchObject({ pending: 0, plugins: [] });
    expect(await journalCount(handle, '__drizzle_migrations')).toBeGreaterThan(1);
    expect((await migrationStatus(handle, [notesPlugin()])).plugins[0]).toEqual({
      id: 'acme.notes',
      latest: '0001_pinned',
      applied: '0000_notes',
      pending: 1,
    });

    await runMigrations(handle, [notesPlugin()]);
    expect((await migrationStatus(handle, [notesPlugin()])).plugins[0]).toMatchObject({
      applied: '0001_pinned',
      pending: 0,
    });
  });

  it('is idempotent', async () => {
    await runMigrations(handle, [notesPlugin(), notesPlugin()]);
    await runMigrations(handle, [notesPlugin()]);
    expect(await journalCount(handle, JOURNAL)).toBe(2);
  });

  it('ignores plugins without tables and refuses two names with one id', async () => {
    await runMigrations(handle, [definePlugin({ name: 'plain' })]);
    const twin = { ...notesPlugin(), name: 'acme/notes' };
    await expect(runMigrations(handle, [notesPlugin(), twin])).rejects.toThrow(
      /two plugins with tables share the id "acme.notes"/,
    );
  });
});

describe('plugin repositories', () => {
  let database: TestDatabase;
  let handle: DatabaseHandle;
  let repos: Repositories;
  let seq = 0;

  const notes = (bound: Repositories) => new NotesRepository(databaseContextOf(bound));
  const space = async (bound: Repositories = repos) => {
    const name = `notes-${++seq}`;
    return bound.spaces.create({ name, machineName: name, url: 'http://notes.test' });
  };

  beforeAll(async () => {
    database = await createTestDatabase('plugin_repositories', { plugins: [notesPlugin()] });
    handle = await createDatabase({ url: database.url, max: 4 });
    repos = createRepositories(handle, registry());
  });
  afterAll(async () => {
    await handle?.close();
    await database?.drop();
  });

  it('creates the plugin tables on a test database', async () => {
    expect((await migrationStatus(handle, [notesPlugin()])).plugins[0]?.pending).toBe(0);
  });

  it('creates, reads, updates and deletes rows in the space production environment', async () => {
    const { id: spaceId } = await space();
    const repo = notes(repos);
    const note = await repo.create({ spaceId }, 'hello');
    const production = await repos.environments.production(spaceId);
    expect(note).toMatchObject({ spaceId, environmentId: production?.id, pinned: false });
    expect(note.createdAt).toBeInstanceOf(Date);

    expect(await repo.pin(note.id)).toMatchObject({ id: note.id, pinned: true });
    expect((await repo.list(spaceId)).map((row) => row.body)).toEqual(['hello']);
    expect(await repo.remove(note.id)).toBe(true);
    expect(await repo.findById(note.id)).toBeNull();
  });

  it('joins a core transaction: commits with it and rolls back with it', async () => {
    const kept = await repos.transaction(async (tx) => {
      const row = await space(tx);
      const note = await notes(tx).create({ spaceId: row.id }, 'kept');
      expect(await notes(repos).findById(note.id)).toBeNull();
      return note.id;
    });
    expect(await notes(repos).findById(kept)).not.toBeNull();

    let spaceId = '';
    let noteId = '';
    await expect(
      repos.transaction(async (tx) => {
        spaceId = (await space(tx)).id;
        noteId = (await notes(tx).create({ spaceId }, 'dropped')).id;
        throw new Error('midway');
      }),
    ).rejects.toThrow('midway');
    expect(noteId).not.toBe('');
    expect(await repos.spaces.findById(spaceId)).toBeNull();
    expect(await notes(repos).findById(noteId)).toBeNull();
  });

  it('queues afterCommit on the transaction it joined', async () => {
    const calls: string[] = [];
    await repos.transaction(async (tx) => {
      notes(tx).later(() => calls.push('plugin'));
      expect(calls).toEqual([]);
    });
    expect(calls).toEqual(['plugin']);
  });

  it('deletes the rows of a deleted space', async () => {
    const { id: spaceId } = await space();
    const note = await notes(repos).create({ spaceId }, 'gone');
    await repos.spaces.delete(spaceId);
    expect(await notes(repos).findById(note.id)).toBeNull();
  });

  it('refuses repositories it did not build', () => {
    expect(() => databaseContextOf({} as Repositories)).toThrow(/createRepositories/);
  });
});

// Needs a Postgres server beside SQLite; the SQLite-only CI job has none.
describe.skipIf(TEST_DIALECT === 'sqlite')('plugin tables in migrate-db', () => {
  let source: TestDatabase;
  let target: TestDatabase;

  beforeAll(async () => {
    source = await createTestDatabase('plugin_copy_source', {
      dialect: 'sqlite',
      plugins: [notesPlugin()],
    });
    target = await createTestDatabase('plugin_copy_target', { dialect: 'postgres', empty: true });
  });
  afterAll(async () => {
    await source?.drop();
    await target?.drop();
  });

  it('migrates and copies the plugin tables', async () => {
    const handle = await createDatabase({ url: source.url });
    try {
      const sourceRepos = createRepositories(handle, registry());
      const { id: spaceId } = await sourceRepos.spaces.create({
        name: 'Copy',
        machineName: 'copy',
        url: 'http://copy.test',
      });
      await new NotesRepository(databaseContextOf(sourceRepos)).create({ spaceId }, 'copied');
    } finally {
      await handle.close();
    }

    const report = await migrateSqliteToPostgres({
      source: { url: source.url },
      target: target.url,
      forceOffline: true,
      settleMs: 0,
      plugins: [notesPlugin()],
    });
    expect(report.mismatches).toEqual([]);
    expect(report.tables.find((table) => table.name === 'notes_items')).toMatchObject({
      source: 1,
      target: 1,
    });

    const copy = await createDatabase({ url: target.url });
    try {
      const status = await migrationStatus(copy, [notesPlugin()]);
      expect(status.plugins[0]?.pending).toBe(0);
      const [row] = await rows<{ body: string }>(copy, 'select body from notes_items');
      expect(row?.body).toBe('copied');
    } finally {
      await copy.close();
    }
  });
});
