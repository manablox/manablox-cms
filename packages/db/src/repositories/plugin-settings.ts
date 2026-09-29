import type { Scope } from '@manablox/core';
import { scopeSpaceId } from '@manablox/core';
import { and, eq } from 'drizzle-orm';
import type { SpacePluginSettingsRow } from '../schema/index.js';
import { Repository } from './base.js';

/** Plugin settings per space environment; a scope without an environment is production. */
export class PluginSettingsRepository extends Repository {
  /** The environment's stored settings of the plugin, or `null`. */
  async get(scope: Scope, plugin: string): Promise<Record<string, unknown> | null> {
    const { spacePluginSettings: s } = this.t;
    const row = await this.findOneWhere(s, and(this.inEnvironment(s, scope), eq(s.plugin, plugin)));
    return row?.data ?? null;
  }

  /** Every row of a space, all environments and plugins. */
  listBySpace(spaceId: string): Promise<SpacePluginSettingsRow[]> {
    const { spacePluginSettings: s } = this.t;
    return this.db.select().from(s).where(eq(s.spaceId, spaceId));
  }

  /** Replaces the environment's settings of the plugin. */
  async set(scope: Scope, plugin: string, data: Record<string, unknown>): Promise<void> {
    const { spacePluginSettings: s } = this.t;
    const now = new Date();
    await this.db
      .insert(s)
      .values({
        spaceId: scopeSpaceId(scope),
        environmentId: this.environmentOf(scope),
        plugin,
        data,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: [s.environmentId, s.plugin], set: { data, updatedAt: now } });
  }

  /** Drops the environment's settings of the plugin. */
  async remove(scope: Scope, plugin: string): Promise<void> {
    const { spacePluginSettings: s } = this.t;
    await this.db.delete(s).where(and(this.inEnvironment(s, scope), eq(s.plugin, plugin)));
  }
}
