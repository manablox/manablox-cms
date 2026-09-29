import { assertCan, assertSuperadmin, MIN_PASSWORD_LENGTH } from '@manablox/auth';
import { z } from 'zod';
import { authed, base } from '../base.js';
import type { RpcContext } from '../context.js';
import { machineName, uuid } from '../schemas.js';

const token = z.string().min(16).max(200);
const grant = z.object({ spaceId: uuid, role: machineName });

/** Refused while the instance, or a granted space, is read-only. */
async function assertWritable(context: RpcContext, spaceIds: readonly string[]): Promise<void> {
  await context.manablox.controls.assertWritable(null);
  for (const spaceId of spaceIds) await context.manablox.controls.assertWritable(spaceId);
}

/**
 * Invitations by email. Superadmins manage all of them; space admins (`user:write`) those whose
 * spaces they all manage. `preview` and `accept` are public: the token is the credential.
 */
export const invitationRouter = {
  create: authed
    .input(
      z.object({
        email: z.string().email().max(320),
        grants: z.array(grant).max(50).default([]),
        expiresInDays: z.number().int().min(1).max(30).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertWritable(
        context,
        input.grants.map((entry) => entry.spaceId),
      );
      return context.invitations.create(context.principal, input);
    }),

  /** Every invitation for a superadmin; with `spaceId`, those of a space the caller reads users of. */
  list: authed
    .input(z.object({ spaceId: uuid.optional() }).prefault({}))
    .handler(async ({ input, context }) => {
      if (input.spaceId) assertCan(context.principal, input.spaceId, 'user:read');
      else assertSuperadmin(context.principal);
      return context.invitations.list({ spaceId: input.spaceId });
    }),

  revoke: authed.input(z.object({ id: uuid })).handler(async ({ input, context }) => {
    const current = await context.invitations.get(context.principal, input.id);
    await assertWritable(
      context,
      current.grants.map((entry) => entry.spaceId),
    );
    return context.invitations.revoke(context.principal, input.id);
  }),

  /** A fresh link; the previous one stops working. */
  resend: authed.input(z.object({ id: uuid })).handler(async ({ input, context }) => {
    const current = await context.invitations.get(context.principal, input.id);
    await assertWritable(
      context,
      current.grants.map((entry) => entry.spaceId),
    );
    return context.invitations.resend(context.principal, input.id);
  }),

  /** What a link grants, for the accept page. Public. */
  preview: base
    .input(z.object({ token }))
    .handler(async ({ input, context }) => context.invitations.preview(input.token)),

  /**
   * Public. With `name` and `password` a new account is set up; for an address that has an
   * account, the caller signs in with it first.
   */
  accept: base
    .input(
      z.object({
        token,
        name: z.string().trim().min(1).max(200).optional(),
        password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await context.manablox.controls.assertWritable(null);
      const account =
        input.name !== undefined && input.password !== undefined
          ? { name: input.name, password: input.password }
          : null;
      return context.invitations.accept(input.token, account, context.principal);
    }),
};
