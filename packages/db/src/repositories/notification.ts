import type { NotificationKind } from '@manablox/core';
import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { NotificationRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface NotificationInsert {
  userId: string;
  spaceId?: string | null | undefined;
  kind: NotificationKind;
  title: string;
  body?: string | undefined;
  url?: string | null | undefined;
  targetKind?: string | null | undefined;
  targetId?: string | null | undefined;
  actorId?: string | null | undefined;
  actorLabel?: string | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
}

export interface NotificationFilter {
  unreadOnly?: boolean | undefined;
  kinds?: NotificationKind[] | undefined;
  spaceId?: string | null | undefined;
}

/** One person's inbox; every method but `pruneBefore` is scoped to a `userId`. */
export class NotificationRepository extends Repository {
  /** Inserts one row per recipient in one statement. */
  async createMany(rows: NotificationInsert[]): Promise<NotificationRow[]> {
    const { notifications } = this.t;
    if (rows.length === 0) return [];
    return this.db
      .insert(notifications)
      .values(
        rows.map((row) => ({
          userId: row.userId,
          spaceId: row.spaceId ?? null,
          kind: row.kind,
          title: row.title,
          body: row.body ?? '',
          url: row.url ?? null,
          targetKind: row.targetKind ?? null,
          targetId: row.targetId ?? null,
          actorId: row.actorId ?? null,
          actorLabel: row.actorLabel ?? null,
          meta: row.meta ?? null,
        })),
      )
      .returning();
  }

  pageByUser(
    userId: string,
    filter: NotificationFilter = {},
    pagination: Pagination = { limit: 25, offset: 0 },
  ): Promise<Paginated<NotificationRow>> {
    const { notifications } = this.t;
    const conditions = [eq(notifications.userId, userId)];
    if (filter.unreadOnly) conditions.push(isNull(notifications.readAt));
    if (filter.kinds?.length) conditions.push(inArray(notifications.kind, filter.kinds));
    if (filter.spaceId === null) conditions.push(isNull(notifications.spaceId));
    else if (filter.spaceId) conditions.push(eq(notifications.spaceId, filter.spaceId));
    return this.paginate(
      notifications,
      and(...conditions),
      [desc(notifications.createdAt), desc(notifications.id)],
      pagination,
    );
  }

  findById(id: string, userId: string): Promise<NotificationRow | null> {
    const { notifications } = this.t;
    return this.findOneWhere(
      notifications,
      and(eq(notifications.id, id), eq(notifications.userId, userId)),
    );
  }

  async countUnread(userId: string): Promise<number> {
    const { notifications } = this.t;
    const rows = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows[0]?.count ?? 0;
  }

  /** Marks rows read, keeping existing read times; returns the changed count. */
  async markRead(userId: string, ids: string[]): Promise<number> {
    const { notifications } = this.t;
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.id, ids),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }

  async markUnread(userId: string, ids: string[]): Promise<number> {
    const { notifications } = this.t;
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(notifications)
      .set({ readAt: null })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async markAllRead(userId: string): Promise<number> {
    const { notifications } = this.t;
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async delete(userId: string, ids: string[]): Promise<boolean> {
    const { notifications } = this.t;
    if (ids.length === 0) return false;
    return this.removeWhere(
      notifications,
      and(eq(notifications.userId, userId), inArray(notifications.id, ids)),
    );
  }

  /** Deletes up to `limit` notifications created before `before`; returns how many went. */
  pruneBefore(before: Date, limit: number): Promise<number> {
    const { notifications } = this.t;
    return this.deleteBatch(notifications, lt(notifications.createdAt, before), limit);
  }

  deleteRead(userId: string): Promise<boolean> {
    const { notifications } = this.t;
    return this.removeWhere(
      notifications,
      and(eq(notifications.userId, userId), sql`${notifications.readAt} is not null`),
    );
  }
}
