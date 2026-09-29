import { ManabloxError } from '@manablox/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PushSubscriptionRow } from '../schema/index.js';
import { Repository } from './base.js';

/** Browsers subscribed to a user's web push notifications. */
export class PushSubscriptionRepository extends Repository {
  async listByUsers(userIds: string[]): Promise<PushSubscriptionRow[]> {
    const { pushSubscriptions } = this.t;
    if (userIds.length === 0) return [];
    return this.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
  }

  async listByUser(userId: string): Promise<PushSubscriptionRow[]> {
    const { pushSubscriptions } = this.t;
    return this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt));
  }

  /** Upserts on the endpoint. */
  async upsert(data: {
    userId: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent: string | null;
  }): Promise<PushSubscriptionRow> {
    const { pushSubscriptions } = this.t;
    const [row] = await this.db
      .insert(pushSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: data.userId, keys: data.keys, userAgent: data.userAgent },
      })
      .returning();
    if (!row) throw new ManabloxError('push.subscription.createFailed');
    return row;
  }

  deleteByEndpoint(userId: string, endpoint: string): Promise<boolean> {
    const { pushSubscriptions } = this.t;
    return this.removeWhere(
      pushSubscriptions,
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)),
    );
  }

  /** Removes a subscription the push service reported gone. */
  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.pushSubscriptions, id);
  }

  async markUsed(id: string): Promise<void> {
    const { pushSubscriptions } = this.t;
    await this.db
      .update(pushSubscriptions)
      .set({ lastUsedAt: new Date() })
      .where(eq(pushSubscriptions.id, id));
  }
}
