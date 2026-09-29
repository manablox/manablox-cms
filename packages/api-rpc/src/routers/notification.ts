import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '@manablox/core';
import { z } from 'zod';
import { authed } from '../base.js';
import { pagination, uuid } from '../schemas.js';

const kind = z.enum(NOTIFICATION_KINDS);
const ids = z.array(uuid).min(1).max(200);

/** Per-kind channels; absent means default. Strict, so a misspelt channel errors. */
const preferencesSchema = z.partialRecord(
  kind,
  z.strictObject(
    Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => [channel, z.boolean().optional()])),
  ),
);

const pushSubscription = z.object({
  endpoint: z.string().max(4000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

/** The caller's inbox, preferences and push subscriptions. No `userId` input, so no other account is reachable. */
export const notificationRouter = {
  /** Kinds, channels, and which channels this instance can send on. */
  catalog: authed.handler(async ({ context }) => context.notifications.catalog()),

  list: authed
    .input(
      z
        .object({
          unreadOnly: z.boolean().default(false),
          kinds: z.array(kind).optional(),
          /** A space's notifications, `null` for instance-wide ones, absent for all. */
          spaceId: uuid.nullable().optional(),
          pagination: pagination({ limit: 25, max: 100 }),
        })
        .prefault({}),
    )
    .handler(async ({ input, context }) =>
      context.notifications.list(
        context.principal.userId,
        { unreadOnly: input.unreadOnly, kinds: input.kinds, spaceId: input.spaceId },
        input.pagination,
      ),
    ),

  unreadCount: authed.handler(async ({ context }) => ({
    count: await context.notifications.unreadCount(context.principal.userId),
  })),

  markRead: authed.input(z.object({ ids })).handler(async ({ input, context }) => ({
    changed: await context.notifications.markRead(context.principal.userId, input.ids),
  })),

  markUnread: authed.input(z.object({ ids })).handler(async ({ input, context }) => ({
    changed: await context.notifications.markUnread(context.principal.userId, input.ids),
  })),

  markAllRead: authed.handler(async ({ context }) => ({
    changed: await context.notifications.markAllRead(context.principal.userId),
  })),

  delete: authed.input(z.object({ ids })).handler(async ({ input, context }) => {
    await context.notifications.delete(context.principal.userId, input.ids);
    return { ok: true };
  }),

  deleteRead: authed.handler(async ({ context }) => {
    await context.notifications.deleteRead(context.principal.userId);
    return { ok: true };
  }),

  /** The caller's effective choice per kind and channel. */
  preferences: authed.handler(async ({ context }) =>
    context.notifications.preferences(context.principal.userId),
  ),

  setPreferences: authed
    .input(z.object({ preferences: preferencesSchema }))
    .handler(async ({ input, context }) =>
      context.notifications.setPreferences(context.principal.userId, input.preferences),
    ),

  // --- the caller's push subscriptions ----------------------------------------------

  pushSubscriptions: authed.handler(async ({ context }) =>
    context.notifications.subscriptions(context.principal.userId),
  ),

  pushSubscribe: authed
    .input(pushSubscription)
    .handler(async ({ input, context }) =>
      context.notifications.subscribe(
        context.principal.userId,
        input,
        context.headers.get('user-agent'),
      ),
    ),

  pushUnsubscribe: authed
    .input(z.object({ endpoint: z.string().max(4000) }))
    .handler(async ({ input, context }) => {
      await context.notifications.unsubscribe(context.principal.userId, input.endpoint);
      return { ok: true };
    }),
};
