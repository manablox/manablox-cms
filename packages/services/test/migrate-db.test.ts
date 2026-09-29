import { runAsActor } from '@manablox/core/node';
import {
  createPostgresDatabase,
  createRepositories,
  MigrateDbRefused,
  migrateSqliteToPostgres,
  type PostgresHandle,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase, TEST_DIALECT, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

const alice = { kind: 'user' as const, id: 'u-alice', label: 'alice@example.com' };

// Needs a Postgres server beside SQLite; the SQLite-only CI job has none.
describe.skipIf(TEST_DIALECT === 'sqlite')('manablox migrate-db', () => {
  let ctx: ServiceContext;
  let target: TestDatabase;
  let sourceUrl: string;
  const ids: Record<string, string> = {};

  const migrate = (options: { replace?: boolean; forceOffline?: boolean } = {}) =>
    migrateSqliteToPostgres({
      source: { url: sourceUrl },
      target: target.url,
      batchSize: 1,
      settleMs: 0,
      ...options,
    });

  const setState = (status: 'active' | 'readOnly') =>
    ctx.controls.set({ kind: 'instance' }, 'state', { status });

  beforeAll(async () => {
    ctx = await createServiceContext('migrate_db', {
      fieldTypes: builtinFieldTypes,
      contentTypes: TEST_TYPES,
      dialect: 'sqlite',
    });
    sourceUrl = ctx.manablox.config.database.url;
    target = await createTestDatabase('migrate_db_target', { dialect: 'postgres', empty: true });

    const { repos, spaceId } = ctx;
    const user = await repos.users.create({
      name: 'Alice',
      email: 'alice@example.test',
      role: 'superadmin',
      passwordHash: 'x',
    });
    ids.user = user.id;
    await repos.users.grant(user.id, spaceId, 'owner');

    const article = ctx.ids.article as string;
    const create = (title: string, over: Record<string, unknown> = {}) =>
      runAsActor(alice, () =>
        ctx.content.create({ spaceId, typeId: article, locale: 'en', title, fields: {}, ...over }),
      );
    const home = await create('Bananas home', { slug: 'home' });
    const child = await create('Child', { slug: 'child', parentId: home.id });
    const grandchild = await create('Grandchild', { slug: 'grand', parentId: child.id });
    await runAsActor(alice, () =>
      ctx.content.update(spaceId, child.id, {
        spaceId,
        typeId: article,
        locale: 'en',
        title: 'Child edited',
        slug: 'child',
        parentId: home.id,
        fields: {},
      }),
    );
    await ctx.content.publish(spaceId, home.id);
    await ctx.content.publish(spaceId, child.id);
    ids.home = home.id;
    ids.child = child.id;
    ids.grandchild = grandchild.id;

    const menu = await ctx.menus.create({ spaceId, name: 'Main', machineName: 'main' });
    ids.menu = menu.id;
    await ctx.menus.setItems(spaceId, menu.id, [
      {
        localizationId: home.localizationId,
        children: [
          { url: 'https://example.test/a', label: 'A', children: [{ url: '/b', label: 'B' }] },
        ],
      },
      { localizationId: child.localizationId },
    ]);

    // A child stored before its parent, so the copy must reorder the self-reference.
    const footer = await ctx.menus.create({ spaceId, name: 'Footer', machineName: 'footer' });
    ids.footer = footer.id;
    const [parent, child2] = [crypto.randomUUID(), crypto.randomUUID()];
    if (ctx.handle.kind !== 'sqlite') throw new Error('expected a SQLite source');
    await ctx.handle.client.execute({
      sql: 'insert into menu_items (rowid, id, menu_id, parent_id, position, label, url) values (?, ?, ?, null, 0, ?, ?)',
      args: [2_000_000, parent, footer.id, 'Parent', '/p'],
    });
    await ctx.handle.client.execute({
      sql: 'insert into menu_items (rowid, id, menu_id, parent_id, position, label, url) values (?, ?, ?, ?, 0, ?, ?)',
      args: [1_000_000, child2, footer.id, parent, 'Child', '/c'],
    });

    await repos.ssoProviders.create({
      providerId: 'acme',
      name: 'Acme',
      issuer: 'https://idp.example.test',
      domain: 'example.test',
      oidcConfig: JSON.stringify({ clientId: 'c' }),
      samlConfig: null,
      requireSso: false,
      showOnSignIn: true,
      createAccounts: true,
      defaultGrants: [{ spaceId, role: 'editor' }],
    });
    await repos.invitations.create({
      email: 'bob@example.test',
      tokenHash: 'hash',
      grants: [{ spaceId, role: 'editor' }],
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'limits.documents', {
      max: 100,
      mode: 'hard',
    });
    await repos.usageCounters.incrementMany([
      { scope: { kind: 'space', id: spaceId }, metric: 'requests', period: '2026-09', delta: 42 },
    ]);
    await repos.usageExternal.insert({
      idempotencyKey: 'k1',
      spaceId,
      metric: 'bandwidth',
      period: '2026-09',
      value: 5_000_000_000,
      mode: 'add',
    });
    await repos.controlEvents.append({ type: 'test.one', scope: { kind: 'instance' } });
    await repos.controlEvents.append({ type: 'test.two', scope: { kind: 'space', id: spaceId } });
    await repos.audit.append({
      action: 'space.update',
      targetKind: 'space',
      targetId: spaceId,
      spaceId,
      meta: { z: 1, a: { y: [1, 2] } },
    });
  });

  afterAll(async () => {
    await ctx?.close();
    await target?.drop();
  });

  it('refuses while the instance is active, without writing the target', async () => {
    await expect(migrate()).rejects.toThrow(MigrateDbRefused);
    await expect(migrate()).rejects.toThrow(/instance is active/);
  });

  describe('copied to Postgres', () => {
    let handle: PostgresHandle;
    let repos: Repositories;
    let report: Awaited<ReturnType<typeof migrateSqliteToPostgres>>;
    const lines: string[] = [];

    beforeAll(async () => {
      await setState('readOnly');
      report = await migrateSqliteToPostgres({
        source: { url: sourceUrl },
        target: target.url,
        batchSize: 1,
        settleMs: 0,
        log: (line) => lines.push(line),
      });
      handle = createPostgresDatabase({ url: target.url, max: 2 });
      repos = createRepositories(handle, ctx.manablox.contentTypes);
    });
    afterAll(async () => {
      await handle?.close();
    });

    it('verifies counts, the audit chain and sampled rows', () => {
      expect(report.mismatches).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.audit.target).toMatchObject({ ok: true });
      expect(report.audit.target.checked).toBeGreaterThan(3);
      expect(report.sampled).toBeGreaterThan(20);
      const counts = Object.fromEntries(report.tables.map((t) => [t.name, t.target]));
      expect(counts).toMatchObject({
        contents: 3,
        published_contents: 2,
        menu_items: 6,
        sso_providers: 1,
        invitations: 1,
        usage_external: 1,
      });
      for (const table of [
        'content_versions',
        'audit_entries',
        'control_settings',
        'control_events',
        'usage_counters',
        'users',
        'memberships',
      ]) {
        expect(counts[table]).toBeGreaterThan(0);
      }
      expect(lines).toContain('copied menu_items: 6');
    });

    it('reads the migrated data through the repositories', async () => {
      const source = ctx.repos;
      // `search` is a tsvector on Postgres and plain text on SQLite.
      const read = async (from: Repositories, id: string, published = false) => {
        const { search: _search, ...row } = (await from.content.findById(id, published)) ?? {};
        return row;
      };
      for (const id of [ids.home, ids.child, ids.grandchild] as string[]) {
        expect(await read(repos, id)).toEqual(await read(source, id));
      }
      expect(await read(repos, ids.child as string, true)).toEqual(
        await read(source, ids.child as string, true),
      );
      const tree = async (from: Repositories) =>
        JSON.parse(
          JSON.stringify(await from.content.listTree(ctx.spaceId, 'en'), (key, value) =>
            key === 'search' ? undefined : value,
          ),
        );
      expect(await tree(repos)).toEqual(await tree(source));
      expect(JSON.stringify(await tree(repos))).toContain(ids.grandchild);
      expect(await repos.menus.listItemTree(ids.menu as string)).toEqual(
        await source.menus.listItemTree(ids.menu as string),
      );
      const footer = await repos.menus.listItemTree(ids.footer as string);
      expect(footer).toEqual(await source.menus.listItemTree(ids.footer as string));
      expect(footer[0]?.children).toHaveLength(1);
      expect(await repos.users.findSpaceRole(ids.user as string, ctx.spaceId)).toBe('owner');
      expect(await repos.usageExternal.total(ctx.spaceId, 'bandwidth', '2026-09')).toBe(
        5_000_000_000,
      );

      // The search column is generated on Postgres.
      const { contents } = handle.tables;
      const found = await handle.db
        .select({ id: contents.id })
        .from(contents)
        .where(handle.dialect.search(contents, 'bananas'));
      expect(found.map((row) => row.id)).toEqual([ids.home]);
    });

    it('continues the sequences', async () => {
      const lastEvent = await ctx.repos.controlEvents.latestSeq();
      const event = await repos.controlEvents.append({
        type: 'test.after',
        scope: { kind: 'instance' },
      });
      expect(event.seq).toBe(lastEvent + 1);

      const entry = await repos.audit.append({
        action: 'space.update',
        targetKind: 'space',
        targetId: ctx.spaceId,
        spaceId: ctx.spaceId,
      });
      expect(entry.seq).toBe(report.audit.target.checked + 1);
      expect(await repos.audit.verify()).toMatchObject({ ok: true });

      await repos.usageExternal.insert({
        idempotencyKey: 'k2',
        spaceId: ctx.spaceId,
        metric: 'bandwidth',
        period: '2026-09',
        value: 1,
        mode: 'add',
      });
      expect(await repos.usageExternal.total(ctx.spaceId, 'bandwidth', '2026-09')).toBe(
        5_000_000_001,
      );
    });

    it('refuses a target with rows unless --replace', async () => {
      await expect(migrate()).rejects.toThrow(/not empty/);
      await setState('active');
      const again = await migrate({ replace: true, forceOffline: true });
      expect(again.mismatches).toEqual([]);
      // The event appended to the target above is gone.
      expect(again.tables.find((t) => t.name === 'control_events')?.target).toBe(
        await ctx.repos.controlEvents.latestSeq(),
      );
    });
  });
});
