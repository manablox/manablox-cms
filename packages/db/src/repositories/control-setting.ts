import { ManabloxError } from '@manablox/core';
import { and, asc, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import type { ControlScopeKind } from '../definitions/controls.js';
import type { ControlSettingRow } from '../schema/index.js';
import { Repository } from './base.js';

export type { ControlScopeKind, UsageExternalMode } from '../definitions/controls.js';

/** The stored `scopeId` of instance rows. */
export const INSTANCE_SCOPE_ID = '';

/** A scope of control rows; `id` is ignored for the instance. */
export interface ControlScopeKey {
  kind: ControlScopeKind;
  id?: string | null | undefined;
}

/** The stored `scopeId` of a scope. */
export function scopeIdOf(scope: ControlScopeKey): string {
  if (scope.kind === 'instance') return INSTANCE_SCOPE_ID;
  if (!scope.id) throw ManabloxError.badRequest('request.invalid', { scope: scope.kind });
  return scope.id;
}

/** Control values per scope, written only through the control API. */
export class ControlSettingRepository extends Repository {
  /** A scope's values, by key. */
  async listByScope(scope: ControlScopeKey): Promise<ControlSettingRow[]> {
    const { controlSettings } = this.t;
    return this.db
      .select()
      .from(controlSettings)
      .where(this.inScope(scope))
      .orderBy(asc(controlSettings.key));
  }

  /** The values of several scopes (instance, group, space) in one query. */
  async listByScopes(scopes: readonly ControlScopeKey[]): Promise<ControlSettingRow[]> {
    if (scopes.length === 0) return [];
    const { controlSettings } = this.t;
    return this.db
      .select()
      .from(controlSettings)
      .where(or(...scopes.map((scope) => this.inScope(scope))))
      .orderBy(asc(controlSettings.scopeKind), asc(controlSettings.key));
  }

  /** The group and space scopes that store at least one value. */
  async storedScopes(): Promise<Array<{ kind: 'group' | 'space'; id: string }>> {
    const { controlSettings } = this.t;
    const rows = await this.db
      .selectDistinct({ kind: controlSettings.scopeKind, id: controlSettings.scopeId })
      .from(controlSettings)
      .where(inArray(controlSettings.scopeKind, ['group', 'space']));
    return rows as Array<{ kind: 'group' | 'space'; id: string }>;
  }

  /** Whether any scope stores a value. */
  async hasAny(): Promise<boolean> {
    const { controlSettings } = this.t;
    const [row] = await this.db.select({ id: controlSettings.id }).from(controlSettings).limit(1);
    return row !== undefined;
  }

  /** Every scope's value of these keys. */
  async listByKeys(keys: readonly string[]): Promise<ControlSettingRow[]> {
    if (keys.length === 0) return [];
    const { controlSettings } = this.t;
    return this.db
      .select()
      .from(controlSettings)
      .where(inArray(controlSettings.key, [...keys]))
      .orderBy(asc(controlSettings.key));
  }

  /** Every stored value, for reads across all scopes. */
  listAll(): Promise<ControlSettingRow[]> {
    const { controlSettings } = this.t;
    return this.db
      .select()
      .from(controlSettings)
      .orderBy(
        asc(controlSettings.scopeKind),
        asc(controlSettings.scopeId),
        asc(controlSettings.key),
      );
  }

  async find(scope: ControlScopeKey, key: string): Promise<ControlSettingRow | null> {
    const { controlSettings } = this.t;
    return this.findOneWhere(
      controlSettings,
      and(this.inScope(scope), eq(controlSettings.key, key)),
    );
  }

  async upsert(
    scope: ControlScopeKey,
    key: string,
    value: unknown,
    updatedBy: string | null = null,
  ): Promise<ControlSettingRow> {
    const [row] = await this.write(scope, { [key]: value }, updatedBy);
    if (!row) throw new ManabloxError('internal.error');
    return row;
  }

  /** Sets several keys of a scope; others are kept. */
  async upsertMany(
    scope: ControlScopeKey,
    values: Record<string, unknown>,
    updatedBy: string | null = null,
  ): Promise<ControlSettingRow[]> {
    return this.write(scope, values, updatedBy);
  }

  /** Makes `values` the scope's full set: other keys are removed, in one transaction. */
  async replaceScope(
    scope: ControlScopeKey,
    values: Record<string, unknown>,
    updatedBy: string | null = null,
  ): Promise<ControlSettingRow[]> {
    const { controlSettings } = this.t;
    const keys = Object.keys(values);
    return this.db.transaction(async (tx) => {
      await tx
        .delete(controlSettings)
        .where(
          and(
            this.inScope(scope),
            ...(keys.length > 0 ? [notInArray(controlSettings.key, keys)] : []),
          ),
        );
      return this.write(scope, values, updatedBy, tx);
    });
  }

  async delete(scope: ControlScopeKey, key: string): Promise<boolean> {
    const { controlSettings } = this.t;
    return this.removeWhere(
      controlSettings,
      and(this.inScope(scope), eq(controlSettings.key, key)),
    );
  }

  /** Removes every value of a scope, e.g. when its space or group is deleted. */
  async deleteScope(scope: ControlScopeKey): Promise<boolean> {
    return this.removeWhere(this.t.controlSettings, this.inScope(scope));
  }

  private async write(
    scope: ControlScopeKey,
    values: Record<string, unknown>,
    updatedBy: string | null,
    db: Executor = this.db,
  ): Promise<ControlSettingRow[]> {
    const { controlSettings } = this.t;
    const entries = Object.entries(values);
    if (entries.length === 0) return [];
    const scopeId = scopeIdOf(scope);
    const now = new Date();
    const rows = await db
      .insert(controlSettings)
      .values(
        entries.map(([key, value]) => ({
          scopeKind: scope.kind,
          scopeId,
          key,
          // JSON `null`, not SQL NULL.
          value: value === null ? sql`'null'` : value,
          updatedAt: now,
          updatedBy,
        })),
      )
      .onConflictDoUpdate({
        target: [controlSettings.scopeKind, controlSettings.scopeId, controlSettings.key],
        set: { value: sql`excluded.value`, updatedAt: now, updatedBy },
      })
      .returning();
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  private inScope(scope: ControlScopeKey): SQL {
    const { controlSettings } = this.t;
    return and(
      eq(controlSettings.scopeKind, scope.kind),
      eq(controlSettings.scopeId, scopeIdOf(scope)),
    ) as SQL;
  }
}
