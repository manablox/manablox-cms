import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { ApiKeyInsert, ApiKeyRow } from '../schema/index.js';
import { Repository } from './base.js';

/** API key rows; hashing and verification live in `@manablox/auth`. */
export class ApiKeyRepository extends Repository {
  async create(data: ApiKeyInsert): Promise<ApiKeyRow | null> {
    const { apikeys } = this.t;
    const [row] = await this.db.insert(apikeys).values(data).returning();
    return row ?? null;
  }

  /** The deleted key, or `null` if there was none. */
  async deleteReturning(id: string): Promise<Pick<ApiKeyRow, 'id' | 'name' | 'userId'> | null> {
    const { apikeys } = this.t;
    const [row] = await this.db
      .delete(apikeys)
      .where(eq(apikeys.id, id))
      .returning({ id: apikeys.id, name: apikeys.name, userId: apikeys.userId });
    return row ?? null;
  }

  /** A user's keys, without the digest. */
  listByUser(userId: string) {
    const { apikeys } = this.t;
    return this.db
      .select({
        id: apikeys.id,
        name: apikeys.name,
        start: apikeys.start,
        enabled: apikeys.enabled,
        expiresAt: apikeys.expiresAt,
        lastRequest: apikeys.lastRequest,
        spaceIds: apikeys.spaceIds,
        environmentIds: apikeys.environmentIds,
        permissions: apikeys.permissions,
        createdAt: apikeys.createdAt,
      })
      .from(apikeys)
      .where(eq(apikeys.userId, userId));
  }

  findEnabledByPrefix(prefix: string): Promise<ApiKeyRow | null> {
    const { apikeys } = this.t;
    return this.findOneWhere(apikeys, and(eq(apikeys.prefix, prefix), eq(apikeys.enabled, true)));
  }

  async touch(id: string, at: Date): Promise<void> {
    const { apikeys } = this.t;
    await this.db.update(apikeys).set({ lastRequest: at }).where(eq(apikeys.id, id));
  }

  /** Deletes expired keys and returns them. */
  deleteExpiredReturning(): Promise<Pick<ApiKeyRow, 'id' | 'name'>[]> {
    const { apikeys } = this.t;
    return this.db
      .delete(apikeys)
      .where(and(isNotNull(apikeys.expiresAt), lt(apikeys.expiresAt, this.dialect.now())))
      .returning({ id: apikeys.id, name: apikeys.name });
  }
}
