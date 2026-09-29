import { and, eq } from 'drizzle-orm';
import { Repository } from './base.js';

/** Per-user admin preferences by key. */
export class UserPreferenceRepository extends Repository {
  /** The stored value, or `null`. */
  async get<T = unknown>(userId: string, key: string): Promise<T | null> {
    const { userPreferences } = this.t;
    const row = await this.findOneWhere(
      userPreferences,
      and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)),
    );
    return (row?.value as T | undefined) ?? null;
  }

  async set(userId: string, key: string, value: unknown): Promise<void> {
    const { userPreferences } = this.t;
    const now = new Date();
    await this.db
      .insert(userPreferences)
      .values({ userId, key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value, updatedAt: now },
      });
  }
}
