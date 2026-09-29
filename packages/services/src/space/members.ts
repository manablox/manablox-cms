import { isBuiltInRole, ManabloxError, type SpaceRole } from '@manablox/core';
import type { MembershipRow, Repositories, TransactionRepositories, UserRow } from '@manablox/db';
import { seatIncrement } from '../controls/counters.js';
import type { SpaceContext } from './context.js';

export interface SpaceCandidate {
  id: string;
  name: string;
  email: string;
}

/** The space's members with their accounts. */
export function listMembers(
  ctx: SpaceContext,
  spaceId: string,
): Promise<Array<MembershipRow & { user: UserRow }>> {
  return ctx.repos.users.listMembersBySpace(spaceId);
}

/** Grants a role; demoting the last owner is refused. */
export async function grant(
  ctx: SpaceContext,
  spaceId: string,
  userId: string,
  role: SpaceRole,
): Promise<void> {
  await assertRoleExists(ctx, spaceId, role);
  if (!(await ctx.repos.users.findSpaceRole(userId, spaceId))) {
    await assertSeats(ctx, spaceId, [userId]);
  }
  await ctx.repos.transaction(async (tx) => {
    if (role !== 'owner') await assertNotLastOwner(tx, spaceId, userId);
    const before = await tx.users.findSpaceRole(userId, spaceId);
    await beforeGrant(ctx, spaceId, userId, role, before);
    await tx.users.grant(userId, spaceId, role);
    await auditMember(ctx, 'member.grant', { id: spaceId }, userId, before, role, tx);
    if (!before) await seatsChanged(ctx, spaceId, [userId], 'added', tx);
    granted(ctx, tx, spaceId, userId, role, before);
  });
}

export async function revoke(ctx: SpaceContext, spaceId: string, userId: string): Promise<void> {
  await ctx.repos.transaction(async (tx) => {
    await assertNotLastOwner(tx, spaceId, userId);
    const before = await tx.users.findSpaceRole(userId, spaceId);
    await tx.users.revoke(userId, spaceId);
    await auditMember(ctx, 'member.revoke', { id: spaceId }, userId, before, null, tx);
    if (before) await seatsChanged(ctx, spaceId, [userId], 'removed', tx);
  });
}

/**
 * Adds several members, all or none; existing ones are skipped. `mail: false` tells them in
 * the admin only.
 */
export async function addMembers(
  ctx: SpaceContext,
  spaceId: string,
  userIds: string[],
  role: SpaceRole,
  options: { mail?: boolean } = {},
): Promise<number> {
  await assertRoleExists(ctx, spaceId, role);
  const members = new Set((await listMembers(ctx, spaceId)).map((member) => member.userId));
  await assertSeats(
    ctx,
    spaceId,
    userIds.filter((userId) => !members.has(userId)),
  );
  return ctx.repos.transaction(async (tx) => {
    const taken = new Set(
      (await tx.users.listMembersBySpace(spaceId)).map((member) => member.userId),
    );
    const added = userIds.filter((userId) => !taken.has(userId));
    for (const userId of added) await beforeGrant(ctx, spaceId, userId, role, null);
    for (const userId of added) {
      await tx.users.grant(userId, spaceId, role);
      await auditMember(ctx, 'member.grant', { id: spaceId }, userId, null, role, tx);
      granted(ctx, tx, spaceId, userId, role, null, options.mail);
    }
    await seatsChanged(ctx, spaceId, added, 'added', tx);
    return added.length;
  });
}

/** Non-members for the add-member picker; name, email and id only. */
export async function candidates(
  ctx: SpaceContext,
  spaceId: string,
  search?: string,
): Promise<SpaceCandidate[]> {
  const rows = await ctx.repos.users.listNonMembers(spaceId, search, 100);
  return rows.map((user) => ({ id: user.id, name: user.name, email: user.email }));
}

/** `seat.changed` with the space's member count after the change. */
export async function seatsChanged(
  ctx: SpaceContext,
  spaceId: string,
  userIds: readonly string[],
  change: 'added' | 'removed',
  tx: TransactionRepositories,
): Promise<void> {
  if (userIds.length === 0) return;
  await ctx.manablox.controls.emit(
    'seat.changed',
    { kind: 'space', id: spaceId },
    { spaceId, change, userIds: [...userIds], members: await tx.limitCounts.seats([spaceId]) },
    { tx },
  );
}

/** Refuses new members past a hard `seats` limit, the whole batch at once. */
async function assertSeats(
  ctx: SpaceContext,
  spaceId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await ctx.manablox.controls.assertLimit(spaceId, 'seats', {
    increment: seatIncrement(ctx.repos, userIds),
  });
}

/** `member:beforeGrant`; a throwing handler refuses the grant. */
export async function beforeGrant(
  ctx: SpaceContext,
  spaceId: string,
  userId: string,
  role: SpaceRole,
  previous: string | null,
): Promise<void> {
  await ctx.manablox.hooks.run(
    'member:beforeGrant',
    { spaceId, userId, role, previous },
    { manablox: ctx.manablox, spaceId },
  );
}

/** Notifications and plugins listen to `member:afterGrant`, run once committed. */
function granted(
  ctx: SpaceContext,
  tx: TransactionRepositories,
  spaceId: string,
  userId: string,
  role: SpaceRole,
  previous: string | null,
  mail?: boolean,
): void {
  tx.afterCommit(() =>
    ctx.manablox.hooks.run(
      'member:afterGrant',
      { spaceId, userId, role, previous, ...(mail === undefined ? {} : { mail }) },
      { manablox: ctx.manablox, spaceId },
    ),
  );
}

/** Audit label, e.g. "alice@example.com: editor". */
export async function auditMember(
  ctx: SpaceContext,
  action: 'member.grant' | 'member.revoke',
  space: { id: string },
  userId: string,
  from: string | null,
  to: string | null,
  repos: Repositories | TransactionRepositories = ctx.repos,
): Promise<void> {
  const user = await repos.users.findById(userId);
  await ctx.memberAudit
    .in(repos)
    .record(action, { id: userId, spaceId: space.id, label: user?.email ?? userId }, [
      { path: 'role', from, to },
    ]);
}

/** The role must exist in the space; a custom one needs `customRoles`. */
async function assertRoleExists(ctx: SpaceContext, spaceId: string, role: string): Promise<void> {
  if (!(await ctx.roles.exists(spaceId, role)))
    throw ManabloxError.badRequest('space.member.roleNotFound', { spaceId, role });
  if (!isBuiltInRole(role)) await ctx.manablox.controls.assertFeature(spaceId, 'customRoles');
}

/** An ownerless space could never get an owner again. */
async function assertNotLastOwner(
  repos: Repositories,
  spaceId: string,
  userId: string,
): Promise<void> {
  if ((await repos.users.findSpaceRole(userId, spaceId)) !== 'owner') return;
  const owners = (await repos.users.listMembersBySpace(spaceId)).filter(
    (member) => member.role === 'owner',
  );
  if (owners.length <= 1) throw ManabloxError.badRequest('space.member.lastOwner', { spaceId });
}
