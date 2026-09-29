import { randomBytes } from 'node:crypto';
import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresDatabase, type PostgresHandle } from '../src/client.js';
import { migrateDatabase, migrationStatus } from '../src/migrate.js';
import { migrateSqliteToPostgres } from '../src/migrate-db.js';
import {
  createRepositories,
  databaseContextOf,
  type Repositories,
} from '../src/repositories/index.js';
import { databaseRoleWarning } from '../src/roles.js';
import {
  createTestDatabase,
  TEST_DIALECT,
  type TestDatabase,
  withDatabase,
} from '../src/testing.js';
import { NotesRepository, notesPlugin } from './fixtures/plugin-notes/index.js';

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://manablox:manablox@localhost:5432/manablox';

describe('the database role warning', () => {
  it('warns a production Postgres instance without an owner role, and SQLite with one', () => {
    const pg = 'postgres://app@db/cms';
    expect(databaseRoleWarning({ url: pg }, true)).toMatch(/MIGRATION_DATABASE_URL is not set/);
    expect(databaseRoleWarning({ url: pg }, false)).toBeNull();
    expect(databaseRoleWarning({ url: pg, migrationUrl: 'postgres://owner@db/cms' }, true)).toBe(
      null,
    );
    expect(databaseRoleWarning({ url: 'file:./cms.db' }, true)).toBeNull();
    expect(databaseRoleWarning({ url: 'file:./cms.db', migrationUrl: pg }, false)).toMatch(
      /ignored on SQLite/,
    );
  });
});

describe.skipIf(TEST_DIALECT === 'sqlite')('separate owner and app roles', () => {
  const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const ownerRole = `manablox_test_owner_${suffix}`;
  const appRole = `manablox_test_app_${suffix}`;
  const name = `manablox_test_roles_${suffix}`;
  const as = (role: string) => {
    const url = new URL(withDatabase(ADMIN_URL, name));
    url.username = role;
    url.password = 'secret';
    return url.href;
  };
  const config = () => ({ url: as(appRole), migrationUrl: as(ownerRole) });
  let admin: postgres.Sql;
  let app: PostgresHandle;
  let owner: PostgresHandle;
  let repos: Repositories;
  let source: TestDatabase | undefined;

  const refusal = (run: Promise<unknown>) =>
    run.then(
      () => 'allowed',
      (error: unknown) => (error as Error).message,
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create role "${ownerRole}" login password 'secret'`);
    await admin.unsafe(`create role "${appRole}" login password 'secret'`);
    await admin.unsafe(`create database "${name}" owner "${ownerRole}"`);
    await migrateDatabase(config());
    app = createPostgresDatabase({ url: as(appRole), max: 2 });
    owner = createPostgresDatabase({ url: as(ownerRole), max: 1 });
    repos = createRepositories(app, new ContentTypeRegistry(new FieldTypeRegistry()));
  });

  afterAll(async () => {
    await app?.close();
    await owner?.close();
    await source?.drop();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`drop role if exists "${appRole}"`);
    await admin.unsafe(`drop role if exists "${ownerRole}"`);
    await admin.end();
  });

  it('writes rows, the audit log, events and usage as the app role', async () => {
    const space = await repos.spaces.create({ name: 'Roles', machineName: 'roles', url: 'x' });
    await repos.audit.append({
      spaceId: space.id,
      action: 'content.update',
      targetKind: 'content',
    });
    await repos.transaction((tx) =>
      tx.controlEvents.append({ type: 'space.created', scope: { kind: 'space', id: space.id } }),
    );
    const key = { scope: { kind: 'space' as const, id: space.id }, metric: 'uploads', period: 'p' };
    await repos.transaction((tx) => tx.usageCounters.incrementOnce('b1', [{ ...key, delta: 2 }]));
    expect(await repos.usageCounters.get(key)).toBe(2);
    await repos.usageExternal.insert({
      idempotencyKey: 'k1',
      spaceId: space.id,
      metric: 'apiRequests',
      period: 'p',
      value: 1,
      mode: 'add',
    });
    expect(await migrationStatus(app)).toMatchObject({ pending: 0 });
    await repos.spaces.delete(space.id);
  });

  it('refuses deleting, truncating and DDL but prunes through the function', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60_000);
    await repos.audit.appendMany([
      { spaceId: null, action: 'user.update', targetKind: 'user', at: old },
      { spaceId: null, action: 'user.update', targetKind: 'user' },
    ]);
    expect(await refusal(app.sql`delete from audit_entries`)).toMatch(/permission denied/);
    expect(await refusal(app.sql`update audit_entries set action = 'x'`)).toMatch(
      /permission denied/,
    );
    expect(await refusal(app.sql`truncate audit_entries`)).toMatch(/permission denied/);
    expect(await refusal(app.sql`create table intruder (id int)`)).toMatch(/permission denied/);
    expect(await refusal(app.sql`drop table spaces`)).toMatch(/must be owner/);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    expect((await repos.audit.prune({ spaceId: null, before: cutoff, limit: 10 }))?.count).toBe(1);
    expect(await repos.audit.verify()).toMatchObject({ ok: true });
  });

  it('grants tables added later, by default and on the next migration run', async () => {
    await owner.sql`create table later_default (id int)`;
    await app.sql`insert into later_default values (1)`;

    // A table the default privileges missed, e.g. from before the roles were split.
    await owner.sql`create table later_missed (id int)`;
    await owner.sql.unsafe(`revoke all on later_missed from "${appRole}"`);
    expect(await refusal(app.sql`select * from later_missed`)).toMatch(/permission denied/);
    await migrateDatabase(config());
    expect(await app.sql`select * from later_missed`).toEqual([]);
    expect(await refusal(app.sql`delete from audit_entries`)).toMatch(/permission denied/);
    await owner.sql`drop table later_default, later_missed`;
  });

  it('grants plugin tables and journals migrated later', async () => {
    await migrateDatabase(config(), { plugins: [notesPlugin()] });
    const space = await repos.spaces.create({ name: 'Notes', machineName: 'notes', url: 'x' });
    const note = await new NotesRepository(databaseContextOf(repos)).create(
      { spaceId: space.id },
      'as the app',
    );
    expect(note.body).toBe('as the app');
    expect((await migrationStatus(app, [notesPlugin()])).plugins[0]?.pending).toBe(0);
    expect(await refusal(app.sql`drop table notes_items`)).toMatch(/must be owner/);
    await repos.spaces.delete(space.id);
  });

  it('refuses an app role that is the owner or a superuser', async () => {
    await expect(
      migrateDatabase({ url: as(ownerRole), migrationUrl: as(ownerRole) }),
    ).rejects.toThrow(/is the migration role/);
    await expect(
      migrateDatabase({ url: withDatabase(ADMIN_URL, name), migrationUrl: as(ownerRole) }),
    ).rejects.toThrow(/must not be a superuser/);
  });

  it('refuses a same-role setup before migrating anything', async () => {
    const fresh = `${name}_fresh`;
    await admin.unsafe(`create database "${fresh}" owner "${ownerRole}"`);
    const url = new URL(as(ownerRole));
    url.pathname = `/${fresh}`;
    try {
      await expect(migrateDatabase({ url: url.href, migrationUrl: url.href })).rejects.toThrow(
        /is the migration role/,
      );
      const check = postgres(url.href, { max: 1, onnotice: () => {} });
      const [row] = await check<{ journal: string | null; spaces: string | null }[]>`
        select to_regclass('drizzle.__drizzle_migrations')::text as journal,
          to_regclass('public.spaces')::text as spaces`;
      await check.end();
      expect(row).toEqual({ journal: null, spaces: null });
    } finally {
      await admin.unsafe(`drop database if exists "${fresh}" with (force)`);
    }
  });

  it('grants the app role again after migrate-db replaces the schema', async () => {
    source = await createTestDatabase('roles_source', { dialect: 'sqlite' });
    await app.sql`insert into spaces (id, name, machine_name, url)
      values (gen_random_uuid(), 'Filled', 'filled', 'x')`;
    const report = await migrateSqliteToPostgres({
      source: { url: source.url },
      target: as(ownerRole),
      replace: true,
      forceOffline: true,
      settleMs: 0,
    });
    expect(report.ok).toBe(true);
    await repos.spaces.create({ name: 'After', machineName: 'after', url: 'x' });
    expect(await refusal(app.sql`delete from audit_entries`)).toMatch(/permission denied/);
    expect(await refusal(app.sql`create table intruder (id int)`)).toMatch(/permission denied/);
  });
});
