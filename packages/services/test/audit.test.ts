import { runAsActor } from '@manablox/core/node';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('audit', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const alice = { kind: 'user' as const, id: 'u-alice', label: 'alice@example.com' };

const document = (title: string, over: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title,
    fields: {},
    ...over,
  });

describe('the activity log', () => {
  it("records a document's life: created, edited field by field, published, deleted", async () => {
    const row = await runAsActor(alice, () => document('Audited', { slug: 'audited' }));
    await runAsActor(alice, () =>
      ctx.content.update(ctx.spaceId, row.id, {
        spaceId: ctx.spaceId,
        typeId: row.typeId,
        locale: 'en',
        title: 'Audited twice',
        slug: 'audited',
        fields: { ...row.fields, body: { type: 'doc', content: [{ type: 'paragraph' }] } },
      }),
    );
    await runAsActor(alice, () => ctx.content.publish(ctx.spaceId, row.id));
    await ctx.content.delete(ctx.spaceId, row.id);

    const history = await ctx.audit.forTarget(ctx.spaceId, 'content', row.id);
    expect(history.items.map((entry) => entry.action)).toEqual([
      'content.delete',
      'content.publish',
      'content.update',
      'content.create',
    ]);

    const [deleted, published, edited, created] = history.items;
    expect(created).toMatchObject({
      actorKind: 'user',
      actorId: 'u-alice',
      actorLabel: 'alice@example.com',
      targetLabel: 'Audited',
      spaceId: ctx.spaceId,
    });
    expect(created?.changes).toContainEqual({ path: 'title', from: undefined, to: 'Audited' });
    // Per field, never the fields blob or derived columns.
    expect(created?.changes.some((change) => change.path === 'fields')).toBe(false);
    expect(created?.changes.some((change) => change.path === 'path')).toBe(false);

    expect(edited?.changes.map((change) => change.path).sort()).toEqual(['fields.body', 'title']);
    expect(edited?.changes.find((change) => change.path === 'title')).toEqual({
      path: 'title',
      from: 'Audited',
      to: 'Audited twice',
    });
    expect(published?.changes).toContainEqual({ path: 'status', from: 'draft', to: 'published' });
    // Outside a request the system is the actor.
    expect(deleted).toMatchObject({ actorKind: 'system', targetLabel: 'Audited twice' });
    expect(deleted?.changes).toContainEqual({
      path: 'title',
      from: 'Audited twice',
      to: undefined,
    });
  });

  it("records the space's own writes and its memberships, naming the member", async () => {
    const user = await ctx.repos.users.create({
      name: 'Bob',
      email: 'bob@example.com',
      role: 'editor',
      passwordHash: 'x',
    });
    await runAsActor(alice, async () => {
      await ctx.spaces.update(ctx.spaceId, { name: 'Renamed' });
      await ctx.spaces.grant(ctx.spaceId, user.id, 'editor');
      await ctx.spaces.grant(ctx.spaceId, user.id, 'admin');
      await ctx.spaces.revoke(ctx.spaceId, user.id);
    });

    const page = await ctx.audit.list(ctx.spaceId, { actorId: 'u-alice' });
    const actions = page.items.map((entry) => `${entry.action}:${entry.targetLabel ?? ''}`);
    expect(actions.slice(0, 4)).toEqual([
      'member.revoke:bob@example.com',
      'member.grant:bob@example.com',
      'member.grant:bob@example.com',
      'space.update:Renamed',
    ]);
    const promoted = page.items[1];
    expect(promoted?.changes).toEqual([{ path: 'role', from: 'editor', to: 'admin' }]);
    const renamed = page.items[3];
    expect(renamed?.changes).toEqual([{ path: 'name', from: 'S', to: 'Renamed' }]);
  });

  it('records menus, roles and content types with their labels', async () => {
    await runAsActor(alice, async () => {
      const menu = await ctx.menus.create({
        spaceId: ctx.spaceId,
        name: 'Main',
        machineName: 'main',
      });
      await ctx.menus.setItems(ctx.spaceId, menu.id, [
        { url: 'https://example.test', label: 'Site' },
      ]);
      const role = await ctx.roles.create(ctx.spaceId, {
        name: 'Blogger',
        machineName: 'blogger',
        permissions: ['content:read'],
      });
      await ctx.roles.update(ctx.spaceId, role.id as string, {
        name: 'Blogger',
        machineName: 'blogger',
        permissions: ['content:read', 'content:write'],
      });
      const type = await ctx.contentTypes.create({
        name: 'note',
        spaceId: ctx.spaceId,
        fields: [{ name: 'text', type: 'string' }],
      });
      await ctx.contentTypes.delete(ctx.spaceId, type.id);
    });

    const page = await ctx.audit.list(
      ctx.spaceId,
      { targetKind: 'menu' },
      { by: 'at', direction: 'asc' },
    );
    expect(page.items.map((entry) => entry.action)).toEqual(['menu.create', 'menu.setItems']);
    expect(page.items[1]?.changes).toEqual([
      {
        path: 'items',
        from: [],
        to: [{ localizationId: null, label: 'Site', url: 'https://example.test' }],
      },
    ]);

    const roles = await ctx.audit.list(
      ctx.spaceId,
      { targetKind: 'role' },
      { by: 'at', direction: 'asc' },
    );
    expect(roles.items.map((entry) => entry.action)).toEqual(['role.create', 'role.update']);
    expect(roles.items[1]?.changes).toEqual([
      {
        path: 'permissions',
        from: ['space:read', 'contentType:read', 'content:read'],
        to: ['space:read', 'contentType:read', 'content:read', 'content:write'],
      },
    ]);

    const types = await ctx.audit.list(ctx.spaceId, { targetKind: 'contentType' });
    expect(types.items.map((entry) => `${entry.action}:${entry.targetLabel}`)).toEqual([
      'contentType.delete:Note',
      'contentType.create:Note',
    ]);
  });

  it("keeps another space's entries out of a space's listing and refuses its entry by id", async () => {
    const other = await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'x' });
    const menu = await ctx.menus.create({ spaceId: other.id, name: 'Elsewhere', machineName: 'e' });
    const theirs = await ctx.audit.list(other.id, { targetId: menu.id });
    expect(theirs.total).toBe(1);
    const entry = theirs.items[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    const mine = await ctx.audit.list(ctx.spaceId, { targetId: menu.id });
    expect(mine.total).toBe(0);
    await expect(ctx.audit.get(ctx.spaceId, entry.id)).rejects.toMatchObject({
      key: 'audit.notFound',
    });
    expect((await ctx.audit.get(other.id, entry.id)).id).toBe(entry.id);
    expect((await ctx.audit.get(null, entry.id)).id).toBe(entry.id);
  });

  it('verifies the chain end to end after everything above', async () => {
    const result = await ctx.audit.verify();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(10);
  });
});
