import { z } from 'zod';
import { base } from '../base.js';
import { linkOptions, passwordLink, userIdParam, userSchema } from '../schemas.js';

export const userRoutes = {
  list: base
    .route({
      method: 'GET',
      path: '/users',
      summary: 'Accounts with role, memberships and last sign-in',
      tags: ['users'],
    })
    .output(z.object({ items: z.array(userSchema) }))
    .handler(async ({ context }) => ({ items: await context.api.listUsers() })),

  createOwner: base
    .route({
      method: 'POST',
      path: '/users/owner',
      summary: 'Create the superadmin and return a set-password link',
      tags: ['users'],
      successStatus: 201,
    })
    .input(
      linkOptions.extend({
        email: z.email().max(254),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .output(passwordLink.extend({ user: userSchema }))
    .handler(({ input, context }) => context.api.createOwner(input)),

  resetLink: base
    .route({
      method: 'POST',
      path: '/users/{id}/reset-link',
      summary: 'A new set-password link for an account',
      tags: ['users'],
      inputStructure: 'detailed',
    })
    .input(z.object({ params: z.object({ id: userIdParam }), body: linkOptions.optional() }))
    .output(passwordLink)
    .handler(({ input, context }) => context.api.resetLink(input.params.id, input.body ?? {})),

  revokeSessions: base
    .route({
      method: 'POST',
      path: '/users/{id}/revoke-sessions',
      summary: 'Sign an account out everywhere',
      tags: ['users'],
    })
    .input(z.object({ id: userIdParam }))
    .output(z.object({ revoked: z.literal(true) }))
    .handler(async ({ input, context }) => {
      await context.api.revokeSessions(input.id);
      return { revoked: true as const };
    }),
};
