import {
  type AuditActor,
  auditor,
  compactNotificationPreferences,
  ManabloxError,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KIND_LIST,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationKind,
  type NotificationKindInfo,
  type NotificationPreference,
  type NotificationPreferences,
  resolveNotificationPreferences,
} from '@manablox/core';
import { currentActor, type Manablox } from '@manablox/core/node';
import type {
  NotificationFilter,
  NotificationRow,
  Paginated,
  Pagination,
  PushSubscriptionRow,
  Repositories,
  UserRow,
} from '@manablox/db';
import type { Mailer } from './notify/mail.js';
import { isPushConfigured, type Pusher } from './notify/push.js';
import type { RealtimeService } from './realtime.service.js';

export type { NotificationFilter, NotificationRow };

export interface NotificationChannels {
  mailer?: Mailer | null | undefined;
  pusher?: Pusher | null | undefined;
  /** Admin base URL for links. */
  adminUrl?: string | undefined;
}

/** One thing to tell some people. */
export interface NotifyInput {
  kind: NotificationKind;
  /** Duplicates and the actor are dropped; see `excludeActor`. */
  recipients: readonly string[];
  spaceId?: string | null | undefined;
  title: string;
  body?: string | undefined;
  /** A path inside the admin: `/content/<id>`. */
  url?: string | null | undefined;
  targetKind?: string | null | undefined;
  targetId?: string | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
  /** The person who caused it, when not the current actor. */
  actor?: AuditActor | undefined;
  /** Whether the actor is told about their own action; `false` by default. */
  includeActor?: boolean | undefined;
  /** `false` sends no mail, whatever the preferences. */
  mail?: boolean | undefined;
}

export interface NotifyResult {
  /** In-app rows written. */
  inApp: NotificationRow[];
  /** Who was mailed and pushed. */
  emailed: string[];
  pushed: string[];
}

export interface NotificationCatalog {
  kinds: NotificationKindInfo[];
  channels: Array<{ id: NotificationChannel; label: string; description: string }>;
  /** Whether the instance can actually send on each channel. */
  available: Record<NotificationChannel, boolean>;
  /** VAPID public key a browser subscribes with, when push is configured. */
  pushPublicKey: string | null;
}

/** Delivers notifications per preference: in-app, realtime, and best-effort mail and push. */
export class NotificationService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly realtime: RealtimeService | null = null,
    private readonly channels: NotificationChannels = {},
  ) {}

  /** Kinds and channels for the preferences form, and which channels work. */
  catalog(): NotificationCatalog {
    return {
      kinds: [...NOTIFICATION_KIND_LIST],
      channels: NOTIFICATION_CHANNELS.map((id) => ({ id, ...NOTIFICATION_CHANNEL_LABELS[id] })),
      available: {
        inApp: true,
        email: Boolean(this.channels.mailer),
        push: Boolean(this.channels.pusher),
      },
      pushPublicKey: this.channels.pusher?.publicKey ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const actor = input.actor ?? currentActor();
    const actorId = actor.kind === 'user' || actor.kind === 'apikey' ? actor.id : null;
    const recipientIds = [...new Set(input.recipients)].filter(
      (id) => input.includeActor || id !== actorId,
    );
    const result: NotifyResult = { inApp: [], emailed: [], pushed: [] };
    if (recipientIds.length === 0) return result;

    const users = await this.repos.users.listByIds(recipientIds);
    const wanting: Record<NotificationChannel, UserRow[]> = { inApp: [], email: [], push: [] };
    for (const user of users) {
      if (user.banned) continue;
      const preference = resolveNotificationPreferences(user.notificationPreferences)[input.kind];
      for (const channel of NOTIFICATION_CHANNELS) {
        if (preference[channel]) wanting[channel].push(user);
      }
    }

    result.inApp = await this.repos.notifications.createMany(
      wanting.inApp.map((user) => ({
        userId: user.id,
        spaceId: input.spaceId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? '',
        url: input.url ?? null,
        targetKind: input.targetKind ?? null,
        targetId: input.targetId ?? null,
        actorId,
        actorLabel: actor.label,
        meta: input.meta ?? null,
      })),
    );
    for (const row of result.inApp) this.realtime?.publishNotification(toEvent(row));

    // Off the request path; `settle()` waits for these.
    if (input.mail === false) wanting.email = [];
    this.track(Promise.all([this.email(wanting.email, input), this.push(wanting.push, input)]));
    result.emailed = wanting.email.map((user) => user.id);
    result.pushed = wanting.push.map((user) => user.id);
    return result;
  }

  private readonly inflight = new Set<Promise<unknown>>();

  private track(promise: Promise<unknown>): void {
    const tracked = promise
      .catch((error) => this.manablox.logger.warn({ err: error }, 'notification delivery failed'))
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  /** Resolves once every mail and push started so far has been attempted. */
  async settle(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  private async email(users: UserRow[], input: NotifyInput): Promise<void> {
    const mailer = this.channels.mailer;
    if (!mailer || users.length === 0) return;
    // Used-up mails skip the mail; the in-app notification stands.
    const allowed = await this.manablox.controls.assertUsage(input.spaceId ?? null, 'mails').then(
      () => true,
      (error: unknown) => {
        if (ManabloxError.is(error) && error.key === 'control.usage') return false;
        throw error;
      },
    );
    if (!allowed) return;
    const link = this.adminLink(input.url);
    const text = [input.body ?? '', link ? `\n${link}` : ''].filter(Boolean).join('\n').trim();
    await Promise.all(
      users.map(async (user) => {
        try {
          await mailer.send({ to: [user.email], subject: input.title, text: text || input.title });
          await this.manablox.hooks.observe(
            'mail:afterSend',
            {
              spaceId: input.spaceId ?? null,
              kind: 'notification',
              recipients: 1,
              transport: 'instance',
            },
            { manablox: this.manablox, spaceId: input.spaceId ?? null },
          );
        } catch (error) {
          this.manablox.logger.warn(
            { err: error, userId: user.id, kind: input.kind },
            'notification mail not sent',
          );
        }
      }),
    );
  }

  // --- push subscriptions: one row per push-enabled browser ------------------------

  subscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    return this.repos.pushSubscriptions.listByUser(userId);
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<PushSubscriptionRow> {
    if (!isPushConfigured(this.manablox.config.push)) {
      throw ManabloxError.badRequest('push.notConfigured');
    }
    if (!/^https:\/\//.test(subscription.endpoint)) {
      throw ManabloxError.badRequest('push.subscriptionInvalid');
    }
    return this.repos.pushSubscriptions.upsert({ userId, ...subscription, userAgent });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.repos.pushSubscriptions.deleteByEndpoint(userId, endpoint);
  }

  private async push(users: UserRow[], input: NotifyInput): Promise<void> {
    const pusher = this.channels.pusher;
    if (!pusher || users.length === 0) return;
    const subscriptions = await this.repos.pushSubscriptions.listByUsers(users.map((u) => u.id));
    const payload = { title: input.title, body: input.body ?? '', url: this.adminLink(input.url) };
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const outcome = await pusher.send(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            payload,
          );
          if (outcome === 'gone') await this.repos.pushSubscriptions.delete(subscription.id);
          else await this.repos.pushSubscriptions.markUsed(subscription.id);
        } catch (error) {
          this.manablox.logger.warn(
            { err: error, userId: subscription.userId, kind: input.kind },
            'notification push not sent',
          );
        }
      }),
    );
  }

  private adminLink(url: string | null | undefined): string | null {
    if (!url) return null;
    const base = this.channels.adminUrl ?? this.manablox.config.server.adminUrl;
    if (!base) return url;
    return `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  }

  // -------------------------------------------------------------------------
  // The inbox
  // -------------------------------------------------------------------------

  list(
    userId: string,
    filter: NotificationFilter = {},
    pagination?: Pagination,
  ): Promise<Paginated<NotificationRow>> {
    return this.repos.notifications.pageByUser(userId, filter, pagination);
  }

  unreadCount(userId: string): Promise<number> {
    return this.repos.notifications.countUnread(userId);
  }

  async get(userId: string, id: string): Promise<NotificationRow> {
    const row = await this.repos.notifications.findById(id, userId);
    if (!row) throw ManabloxError.notFound('notification.notFound', { id });
    return row;
  }

  markRead(userId: string, ids: string[]): Promise<number> {
    return this.repos.notifications.markRead(userId, ids);
  }

  markUnread(userId: string, ids: string[]): Promise<number> {
    return this.repos.notifications.markUnread(userId, ids);
  }

  markAllRead(userId: string): Promise<number> {
    return this.repos.notifications.markAllRead(userId);
  }

  delete(userId: string, ids: string[]): Promise<boolean> {
    return this.repos.notifications.delete(userId, ids);
  }

  deleteRead(userId: string): Promise<boolean> {
    return this.repos.notifications.deleteRead(userId);
  }

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  /** Every kind with the person's effective choice, defaults filled in. */
  async preferences(userId: string): Promise<Record<NotificationKind, NotificationPreference>> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw ManabloxError.notFound('user.notFound', { id: userId });
    return resolveNotificationPreferences(user.notificationPreferences);
  }

  /** Replaces the whole table, storing only overrides of the defaults. */
  async setPreferences(
    userId: string,
    resolved: Partial<Record<NotificationKind, Partial<NotificationPreference>>>,
  ): Promise<Record<NotificationKind, NotificationPreference>> {
    const before = await this.repos.users.findById(userId);
    if (!before) throw ManabloxError.notFound('user.notFound', { id: userId });
    const compact: NotificationPreferences = compactNotificationPreferences(resolved);
    const user = await this.repos.users.setNotificationPreferences(userId, compact);
    await auditor(this.repos, 'user', (row: UserRow) => row.email).record(
      'user.setNotificationPreferences',
      user,
      [
        {
          path: 'notificationPreferences',
          from: before.notificationPreferences,
          to: user.notificationPreferences,
        },
      ],
    );
    return resolveNotificationPreferences(user.notificationPreferences);
  }

  /** Notifies on role grants. Approvals notify from their own service. */
  attach(): void {
    this.manablox.hooks.on(
      'member:afterGrant',
      async ({ spaceId, userId, role, previous, mail }) => {
        if (previous === role) return;
        const space = await this.repos.spaces.findById(spaceId);
        const spaceName = space?.name ?? 'a space';
        await this.notify({
          kind: 'member.granted',
          recipients: [userId],
          spaceId,
          title: previous
            ? `Your role in ${spaceName} is now ${role}`
            : `You were added to ${spaceName} as ${role}`,
          body: previous
            ? `Your role changed from ${previous} to ${role}.`
            : 'Pick the space in the sidebar to start working in it.',
          url: '/',
          targetKind: 'space',
          targetId: spaceId,
          meta: { role, previous },
          mail,
        });
      },
      { source: '@manablox/services/notifications' },
    );
  }
}

export function toEvent(row: NotificationRow): NotificationEvent {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    spaceId: row.spaceId,
    at: row.createdAt.toISOString(),
  };
}
