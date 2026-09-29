import type { ControlScope, FeatureKey } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScheduleService } from '../src/schedule.service.js';
import {
  createServiceContext,
  type ServiceContext,
  spaceGroup,
  withControls,
} from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
/** A second space, never switched off. */
let otherId: string;
let restores: Array<() => Promise<void>> = [];

beforeAll(async () => {
  ctx = await createServiceContext('feature_controls', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      ...TEST_TYPES,
      { name: 'product', kind: 'data', fields: [{ name: 'sku', type: 'string' }] },
    ],
  });
  otherId = (await ctx.repos.spaces.create({ name: 'T', machineName: 't', url: 'http://y' })).id;
});
afterEach(async () => {
  const pending = restores.reverse();
  restores = [];
  for (const restore of pending) await restore();
});
afterAll(async () => {
  await ctx?.close();
});

const LOCKED = { message: 'Upgrade to unlock', link: 'https://example.com/upgrade' };

/** Switches `keys` off at `scope`, with a message and link, until the test ends. */
async function off(keys: FeatureKey[], scope: ControlScope = { kind: 'instance' }) {
  const features = Object.fromEntries(keys.map((key) => [key, { enabled: false, ...LOCKED }]));
  restores.push(await withControls(ctx, { scope, features }));
}

const space = (): ControlScope => ({ kind: 'space', id: ctx.spaceId });

/** Resolves to the refusal a switched-off `feature` throws. */
async function refused(promise: Promise<unknown>, feature: FeatureKey): Promise<void> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toMatchObject({
    status: 403,
    key: 'control.feature',
    details: [{ key: 'control.feature', params: { feature, ...LOCKED } }],
  });
}

let seq = 0;
const article = (spaceId = ctx.spaceId, over: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: `Doc ${++seq}`,
    fields: {},
    ...over,
  });

const user = (email: string) =>
  ctx.repos.users.create({ name: email, email, role: 'editor', passwordHash: 'x' });

const future = () => new Date(Date.now() + 3_600_000);

describe('customRoles', () => {
  it('off at the instance refuses role writes and granting a custom role; reads and built-in grants pass', async () => {
    const role = await ctx.roles.create(ctx.spaceId, {
      name: 'Blogger',
      machineName: 'blogger',
      permissions: [],
    });
    const member = await user('roles@example.com');
    await off(['customRoles']);

    const input = { name: 'Writer', machineName: 'writer', permissions: [] };
    await refused(ctx.roles.create(ctx.spaceId, input), 'customRoles');
    await refused(ctx.roles.update(ctx.spaceId, role.id as string, input), 'customRoles');
    await refused(ctx.roles.delete(ctx.spaceId, role.id as string), 'customRoles');
    await refused(ctx.spaces.grant(ctx.spaceId, member.id, 'blogger'), 'customRoles');

    expect((await ctx.roles.list(ctx.spaceId)).map((each) => each.machineName)).toContain(
      'blogger',
    );
    await ctx.spaces.grant(ctx.spaceId, member.id, 'viewer');
    expect(await ctx.repos.users.findSpaceRole(member.id, ctx.spaceId)).toBe('viewer');
  });

  it('off, a new type is not granted to the creator’s custom role, which keeps its grants', async () => {
    const role = await ctx.roles.create(ctx.spaceId, {
      name: 'Typist',
      machineName: 'typist',
      permissions: [],
    });
    const member = await user('typist@example.com');
    await ctx.spaces.grant(ctx.spaceId, member.id, 'typist');
    await off(['customRoles']);

    await ctx.contentTypes.create({ name: 'memo', spaceId: ctx.spaceId, fields: [] }, member.id);
    const after = await ctx.roles.get(ctx.spaceId, role.id as string);
    expect(after.permissions).toEqual(role.permissions);
  });

  it('off at a group or space refuses only there', async () => {
    const group = await spaceGroup(ctx, [ctx.spaceId], 'Roles');
    restores.push(async () => ctx.controls.deleteGroup({ id: group.id }));
    await off(['customRoles'], group);
    const input = (name: string) => ({ name, machineName: name, permissions: [] });
    await refused(ctx.roles.create(ctx.spaceId, input('grouped')), 'customRoles');
    await ctx.roles.create(otherId, input('grouped'));
  });
});

describe('approvals', () => {
  it('off refuses switching requiresApproval on and new requests; open ones can still be decided', async () => {
    const reviewed = await ctx.contentTypes.create({
      name: 'reviewed',
      spaceId: ctx.spaceId,
      requiresApproval: true,
      fields: [],
    });
    const doc = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: reviewed.id,
      locale: 'en',
      title: 'Pending',
      fields: {},
    });
    await ctx.approvals.request(ctx.spaceId, doc.id, null);
    const second = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: reviewed.id,
      locale: 'en',
      title: 'Later',
      fields: {},
    });
    await off(['approvals'], space());

    await refused(
      ctx.contentTypes.create({
        name: 'gated',
        spaceId: ctx.spaceId,
        requiresApproval: true,
        fields: [],
      }),
      'approvals',
    );
    const plain = await ctx.contentTypes.create({
      name: 'plain',
      spaceId: ctx.spaceId,
      fields: [],
    });
    await refused(
      ctx.contentTypes.update(ctx.spaceId, plain.id, {
        name: 'plain',
        spaceId: ctx.spaceId,
        requiresApproval: true,
        fields: [],
      }),
      'approvals',
    );
    // Already on: other edits of the type pass.
    await ctx.contentTypes.update(ctx.spaceId, reviewed.id, {
      name: 'reviewed',
      label: 'Reviewed',
      spaceId: ctx.spaceId,
      requiresApproval: true,
      fields: [],
    });

    await refused(ctx.approvals.request(ctx.spaceId, second.id, null), 'approvals');
    expect((await ctx.approvals.state(ctx.spaceId, second.id)).required).toBe(false);

    const { approval } = await ctx.approvals.approve(ctx.spaceId, doc.id, null);
    expect(approval.status).toBe('approved');

    // Another space keeps approvals.
    await ctx.contentTypes.create({
      name: 'gated',
      spaceId: otherId,
      requiresApproval: true,
      fields: [],
    });
  });
});

describe('scheduledPublishing', () => {
  it('off refuses new schedules, still clears them, and pending ones still run', async () => {
    const pending = await article();
    await ctx.content.schedule(ctx.spaceId, pending.id, { publishAt: new Date(Date.now() + 500) });
    const row = await article();
    await off(['scheduledPublishing'], space());

    await refused(
      ctx.content.schedule(ctx.spaceId, row.id, { publishAt: future() }),
      'scheduledPublishing',
    );
    const cleared = await ctx.content.schedule(ctx.spaceId, pending.id, { unpublishAt: null });
    expect(cleared.unpublishAt).toBeNull();

    const scheduler = new ScheduleService(
      ctx.manablox,
      ctx.repos,
      {
        publish: (spaceId, id) => ctx.content.publish(spaceId, id),
        unpublish: (spaceId, id) => ctx.content.unpublish(spaceId, id),
      },
      { now: () => new Date(Date.now() + 60_000) },
    );
    expect((await scheduler.tick()).published).toContain(pending.id);

    const elsewhere = await article(otherId);
    await ctx.content.schedule(otherId, elsewhere.id, { publishAt: future() });
  });
});

describe('versionRestore', () => {
  it('off refuses a restore; versions stay readable', async () => {
    const row = await article();
    await ctx.content.update(ctx.spaceId, row.id, { ...row, title: 'Changed' });
    await off(['versionRestore']);

    await refused(ctx.content.restore(ctx.spaceId, row.id, 1), 'versionRestore');
    expect((await ctx.content.versions(ctx.spaceId, row.id)).items.length).toBeGreaterThan(0);
  });
});

describe('databags', () => {
  it('off refuses databag types and entry writes; entries stay readable', async () => {
    const product = ctx.ids.product as string;
    const entry = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: product,
      locale: 'en',
      title: 'Widget',
      fields: { sku: 'W1' },
    });
    const bag = await ctx.contentTypes.create({
      name: 'colors',
      kind: 'data',
      spaceId: ctx.spaceId,
      fields: [],
    });
    await off(['databags'], space());

    await refused(
      ctx.contentTypes.create({ name: 'sizes', kind: 'data', spaceId: ctx.spaceId, fields: [] }),
      'databags',
    );
    await refused(
      ctx.contentTypes.update(ctx.spaceId, bag.id, {
        name: 'colors',
        kind: 'data',
        spaceId: ctx.spaceId,
        fields: [],
      }),
      'databags',
    );
    await refused(ctx.contentTypes.delete(ctx.spaceId, bag.id), 'databags');
    await refused(
      ctx.content.create({
        spaceId: ctx.spaceId,
        typeId: product,
        locale: 'en',
        title: 'Gadget',
        fields: {},
      }),
      'databags',
    );
    await refused(
      ctx.content.update(ctx.spaceId, entry.id, { ...entry, title: 'Renamed' }),
      'databags',
    );
    await refused(ctx.content.publish(ctx.spaceId, entry.id), 'databags');
    await refused(ctx.content.delete(ctx.spaceId, entry.id), 'databags');

    expect((await ctx.content.get(ctx.spaceId, entry.id))?.title).toBe('Widget');
    // Document types are unaffected.
    await article();
    await ctx.content.create({
      spaceId: otherId,
      typeId: product,
      locale: 'en',
      title: 'Elsewhere',
      fields: {},
    });
  });
});

describe('menus', () => {
  it('off refuses menu writes; menus stay readable', async () => {
    const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'Nav', machineName: 'nav' });
    const doc = await article();
    await off(['menus']);

    await refused(
      ctx.menus.create({ spaceId: ctx.spaceId, name: 'Foot', machineName: 'foot' }),
      'menus',
    );
    await refused(ctx.menus.update(ctx.spaceId, menu.id, { name: 'Main' }), 'menus');
    await refused(
      ctx.menus.setItems(ctx.spaceId, menu.id, [{ localizationId: doc.localizationId }]),
      'menus',
    );
    await refused(
      ctx.menus.setPlacements(ctx.spaceId, doc.localizationId, [
        { menuId: menu.id, parentId: null, index: 0 },
      ]),
      'menus',
    );
    await refused(ctx.menus.delete(ctx.spaceId, menu.id), 'menus');

    expect((await ctx.menus.get(ctx.spaceId, menu.id, 'en')).menu.name).toBe('Nav');
    // Deleting a document still cleans up its entries.
    await ctx.content.delete(ctx.spaceId, doc.id);
  });

  it('off at a group refuses only its spaces', async () => {
    const group = await spaceGroup(ctx, [ctx.spaceId], 'Menus');
    restores.push(async () => ctx.controls.deleteGroup({ id: group.id }));
    await off(['menus'], group);
    await refused(ctx.menus.create({ spaceId: ctx.spaceId, name: 'G', machineName: 'g' }), 'menus');
    await ctx.menus.create({ spaceId: otherId, name: 'G', machineName: 'g' });
  });
});

describe('tags', () => {
  it('off refuses tag writes but lets a save resend the same tags', async () => {
    const doc = await article();
    const [tag] = await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Travel']);
    await off(['tags'], space());

    await refused(ctx.tags.create(ctx.spaceId, 'Food'), 'tags');
    await refused(ctx.tags.rename(ctx.spaceId, tag?.id as string, 'Trips'), 'tags');
    await refused(ctx.tags.delete(ctx.spaceId, tag?.id as string), 'tags');
    await refused(
      ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Travel', 'Food']),
      'tags',
    );
    await refused(ctx.tags.setForContent(ctx.spaceId, doc.localizationId, []), 'tags');

    const same = await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, [' travel ']);
    expect(same.map((row) => row.id)).toEqual([tag?.id]);
    expect((await ctx.tags.list(ctx.spaceId)).map((row) => row.name)).toEqual(['Travel']);

    await ctx.tags.create(otherId, 'Food');
  });
});

describe('transfer and spaceCreate', () => {
  it('transferExport off at a space refuses its export only', async () => {
    await off(['transferExport'], space());
    await refused(ctx.spaces.export(ctx.spaceId), 'transferExport');
    await ctx.spaces.export(otherId);
  });

  it('transferImport or spaceCreate off at the instance refuses an import', async () => {
    const payload = await ctx.spaces.export(otherId);
    const owner = await user('importer@example.com');

    await off(['transferImport']);
    await refused(ctx.spaces.import(payload, owner.id), 'transferImport');
    for (const restore of restores.splice(0)) await restore();

    await off(['spaceCreate']);
    await refused(ctx.spaces.import(payload, owner.id), 'spaceCreate');
  });
});
