import { randomBytes } from 'node:crypto';
import { ManabloxError } from '@manablox/core';
import { PROVISIONED_META_KEY } from '@manablox/db';
import { applySpaceStarter } from '../../space-starter.js';
import type { ControlApiContext } from './context.js';
import { parseGroupRef } from './input.js';
import type {
  ControlLinkOptions,
  ControlOwnerInput,
  ControlPasswordLink,
  ControlSpaceInput,
} from './types.js';

/**
 * Creates a space through `SpaceService.create`, owned by every superadmin. The starter
 * shares its transaction; the group is joined after it commits, before the plugins'
 * after-commit steps, whose failures come back as `warnings`.
 */
export async function provisionSpace(
  ctx: ControlApiContext,
  input: ControlSpaceInput,
): Promise<{ id: string; warnings: string[] }> {
  const { starter, blocks, group, apiHosts, plan, ...data } = input;
  const groupRef = group ? parseGroupRef(group) : null;
  if (groupRef) await ctx.controls.assertGroupRoom(groupRef);
  if (apiHosts?.length) await ctx.apiHosts.assertFree(apiHosts);
  const template = starter === true ? 'basic' : starter || null;
  const [owner, ...others] = (await ctx.repos.users.listByRole('superadmin'))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((user) => user.id);

  const { spaces } = ctx;
  const space = await spaces.create(
    data,
    owner ?? null,
    async (created, tx) => {
      if (others.length > 0) await spaces.using(tx).addMembers(created.id, others, 'owner');
      if (template) {
        await applySpaceStarter(
          { ...ctx, repos: tx },
          created,
          owner ? { userId: owner, roles: ['superadmin', 'owner'] } : null,
          template,
          blocks,
        );
      }
      if (plan) await ctx.contentTypes.using(tx).applyPlan(created.id, plan, owner ?? null);
    },
    // Plugin steps finish after these, with the group's controls in force.
    async (created) => {
      await ctx.afterSpaceCreate?.(created.id);
      if (groupRef) await ctx.controls.assignSpaces(groupRef, [created.id], { checked: true });
      if (apiHosts?.length) await ctx.apiHosts.replace(created.id, apiHosts);
    },
  );
  return { id: space.id, warnings: space.warnings };
}

/**
 * Creates the superadmin without a usable password and makes it owner of every space; the
 * instance counts as provisioned from then on. Refused once any superadmin exists. Returns its id.
 */
export async function createOwnerAccount(
  ctx: ControlApiContext,
  input: ControlOwnerInput,
): Promise<string> {
  const { users, spaces } = ctx;
  return ctx.repos.locks.withLock('control:owner', () =>
    ctx.repos.transaction(async (tx) => {
      if ((await tx.users.countByRole('superadmin')) > 0) {
        throw ManabloxError.conflict('control.owner.exists');
      }
      const user = await users.using(tx).create({
        name: input.name,
        email: input.email,
        // Never handed out; the set-password link replaces it.
        password: randomBytes(32).toString('base64url'),
        role: 'superadmin',
        // The external layer provides the address.
        emailVerified: true,
      });
      for (const space of await tx.spaces.list()) {
        // The set-password mail is the only one the owner gets.
        await spaces.using(tx).addMembers(space.id, [user.id], 'owner', { mail: false });
      }
      await tx.instanceMeta.set(PROVISIONED_META_KEY, {
        at: new Date().toISOString(),
        userId: user.id,
      });
      return user.id;
    }),
  );
}

/** A link to return, and a mailed one when asked and mail is configured. */
export async function passwordLink(
  ctx: ControlApiContext,
  id: string,
  options: ControlLinkOptions,
): Promise<ControlPasswordLink> {
  const { passwordResets, manablox } = ctx;
  const expiresIn = options.expiresIn !== undefined ? { expiresIn: options.expiresIn } : {};
  const link = await passwordResets.createPasswordSetLink(id, expiresIn);
  let mailSent = false;
  if (options.sendMail && passwordResets.mailEnabled) {
    // The account and the returned link stand; a failed mail only reports it.
    mailSent = await passwordResets.sendPasswordSetMail(id, expiresIn).then(
      () => true,
      (error: unknown) => {
        manablox.logger.warn({ err: error, userId: id }, 'set-password mail not sent');
        return false;
      },
    );
  }
  return {
    setPasswordLink: { url: link.url, expiresAt: link.expiresAt.toISOString() },
    mailSent,
  };
}
