import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/client.js';
import { runMigrations, SQLITE_MIGRATIONS_FOLDER } from '../src/migrate.js';

const SPACE = '0190a000-0000-7000-8000-000000000001';
const ENVIRONMENT = '0190a000-0000-7000-8000-000000000002';

/** The SQLite migrations up to, and not including, `tag`. */
function migrationsBefore(tag: string, into: string): string {
  const folder = join(into, 'before');
  cpSync(SQLITE_MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(cut).toBeGreaterThan(0);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  return folder;
}

async function count(handle: DatabaseHandle, table: string): Promise<number> {
  if (handle.kind !== 'sqlite') throw new Error('SQLite only');
  const { rows } = await handle.client.execute(`select count(*) as n from ${table}`);
  return Number(rows[0]?.n);
}

// Rebuilding `spaces` drops it, which on SQLite deletes its rows; with foreign keys on, that
// would cascade through every space's content.
describe('making the space URL optional on SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manablox-space-url-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the spaces and what cascades from them', async () => {
    const handle = await createDatabase({ url: `file:${join(dir, 'cms.db')}`, max: 1 });
    if (handle.kind !== 'sqlite') throw new Error('SQLite only');
    try {
      const { migrate } = await import('drizzle-orm/libsql/migrator');
      await migrate(handle.db as never, {
        migrationsFolder: migrationsBefore('0003_space_url_optional', dir),
        migrationsTable: '__drizzle_migrations',
      });
      await handle.client.execute({
        sql: `insert into spaces (id, name, machine_name, url) values (?, 'Acme', 'acme', 'https://acme.test')`,
        args: [SPACE],
      });
      await handle.client.execute({
        sql: `insert into space_environments (id, space_id, machine_name, name, kind)
              values (?, ?, 'production', 'Production', 'production')`,
        args: [ENVIRONMENT, SPACE],
      });

      await runMigrations(handle);

      expect(await count(handle, 'spaces')).toBe(1);
      expect(await count(handle, 'space_environments')).toBe(1);
      const { rows } = await handle.client.execute('select url from spaces');
      expect(rows[0]?.url).toBe('https://acme.test');
      await handle.client.execute('update spaces set url = null');
      expect((await handle.client.execute('pragma foreign_keys')).rows[0]?.foreign_keys).toBe(1);
      expect((await handle.client.execute('pragma foreign_key_check')).rows).toEqual([]);
    } finally {
      await handle.close();
    }
  });
});
