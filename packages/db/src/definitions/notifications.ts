import type { ApprovalStatus, NotificationKind } from '@manablox/core';
import { users } from './auth.js';
import { contents } from './content.js';
import { id, index, integer, json, table, text, timestamp, uuid } from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/** One in-app notification per recipient; email and push leave no row. */
export const notifications = table(
  'notifications',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    /** Null for instance-wide notifications. */
    spaceId: uuid().references(() => spaces, 'id', { onDelete: 'cascade' }),
    kind: text<NotificationKind>().notNull(),
    title: text().notNull(),
    body: text().notNull().default(''),
    /** Admin path, e.g. `/content/<id>`. */
    url: text(),
    targetKind: text(),
    targetId: text(),
    /** `null` for the system. A snapshot, not a reference. */
    actorId: text(),
    actorLabel: text(),
    meta: json<Record<string, unknown>>(),
    readAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
    index('notifications_target_idx').on(t.targetKind, t.targetId),
    index('notifications_space_idx').on(t.spaceId),
    index('notifications_created_idx').on(t.createdAt),
  ],
);

/** A publish request and its outcome; the service allows one pending per document. */
export const contentApprovals = table(
  'content_approvals',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    contentId: uuid()
      .notNull()
      .references(() => contents, 'id', { onDelete: 'cascade' }),
    typeId: uuid().notNull(),
    status: text<ApprovalStatus>().notNull().default('pending'),
    /** Not a foreign key, so history survives account deletion. */
    requestedBy: uuid(),
    requestedByLabel: text().notNull().default(''),
    requestNote: text(),
    /** The document's version at submission. */
    contentVersion: integer(),
    requestedAt: timestamp().notNull().defaultNow(),
    decidedBy: uuid(),
    decidedByLabel: text(),
    decisionNote: text(),
    decidedAt: timestamp(),
  },
  (t) => [
    index('content_approvals_content_idx').on(t.contentId, t.requestedAt),
    index('content_approvals_space_status_idx').on(t.spaceId, t.status, t.requestedAt),
  ],
);

/** One push-enabled browser per row. */
export const pushSubscriptions = table(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users, 'id', { onDelete: 'cascade' }),
    endpoint: text().notNull().unique('push_subscriptions_endpoint_key'),
    keys: json<{ p256dh: string; auth: string }>().notNull(),
    userAgent: text(),
    createdAt: timestamp().notNull().defaultNow(),
    lastUsedAt: timestamp(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);
