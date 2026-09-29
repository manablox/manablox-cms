import { eq, like } from 'drizzle-orm';
import { Repository } from './base.js';

/** Set once the control API created the owner; the instance stays provisioned from then on. */
export const PROVISIONED_META_KEY = 'provisioned';

/** The instance's id, made once at the first boot (`Manablox.instance`). */
export const INSTANCE_ID_META_KEY = 'instanceId';

/** Internal instance state by key. */
export class InstanceMetaRepository extends Repository {
  /** The stored value, or `null`. */
  async get<T = unknown>(key: string): Promise<T | null> {
    const { instanceMeta } = this.t;
    const row = await this.findOneWhere(instanceMeta, eq(instanceMeta.key, key));
    return (row?.value as T | undefined) ?? null;
  }

  /** Every value whose key starts with `prefix`, by key. */
  async listByPrefix<T = unknown>(prefix: string): Promise<Map<string, T>> {
    const { instanceMeta } = this.t;
    const rows = await this.db
      .select({ key: instanceMeta.key, value: instanceMeta.value })
      .from(instanceMeta)
      .where(like(instanceMeta.key, `${prefix}%`));
    return new Map(rows.map((row) => [row.key, row.value as T]));
  }

  async set(key: string, value: unknown): Promise<void> {
    const { instanceMeta } = this.t;
    const now = new Date();
    await this.db
      .insert(instanceMeta)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: instanceMeta.key, set: { value, updatedAt: now } });
  }

  /**
   * Stores `value` unless the key holds one; returns what the key holds after. Of processes
   * racing to store one, the first write wins and all return it.
   */
  async setIfAbsent<T>(key: string, value: T): Promise<T> {
    const { instanceMeta } = this.t;
    await this.db
      .insert(instanceMeta)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoNothing({ target: instanceMeta.key });
    return (await this.get<T>(key)) as T;
  }

  async delete(key: string): Promise<void> {
    const { instanceMeta } = this.t;
    await this.removeWhere(instanceMeta, eq(instanceMeta.key, key));
  }
}
