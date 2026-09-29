import { z } from 'zod';
import { authed } from '../base.js';

/** Ids of dismissed control banners. */
const bannerIds = z.array(z.string().min(1).max(64)).max(500);

/** Each stored preference with its shape; nothing else is accepted. */
const entry = z.discriminatedUnion('key', [
  z.object({ key: z.literal('banners.dismissed'), value: bannerIds }),
]);

const key = z.enum(['banners.dismissed']);

/** The caller's own admin preferences; no `userId` input, so no other account is reachable. */
export const preferenceRouter = {
  /** `null` until it is set. */
  get: authed.input(z.object({ key })).handler(async ({ input, context }) => ({
    key: input.key,
    value: await context.users.preference<z.infer<typeof bannerIds>>(
      context.principal.userId,
      input.key,
    ),
  })),

  set: authed.input(entry).handler(async ({ input, context }) => {
    await context.users.setPreference(context.principal.userId, input.key, input.value);
    return input;
  }),
};
