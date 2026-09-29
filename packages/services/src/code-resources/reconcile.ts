import type { AuditAction, Auditor } from '@manablox/core';
import type { SpaceRow } from '@manablox/db';
import { entry, type SyncAction, type SyncChange, type SyncOptions } from './shared.js';

/**
 * Per-kind hooks that `reconcile` drives; `W` is the row's write fields, as the kind's
 * repository takes them without the ids it adds.
 */
export interface ResourceReconciler<D, R extends { id: string }, W extends object> {
  kind: string;
  slug: (definition: D) => string;
  /** Derived from space and slug. */
  id: (definition: D) => string;
  /** Must agree with `rowKey`. */
  key: (definition: D) => string;
  rowKey: (row: R) => string;
  /** Skip reason when the slug belongs to another row. */
  taken: string;
  /** The space's current rows; written rows are put back here. */
  rows: R[];
  prepare: (definition: D, current: R | undefined) => Promise<Prepared<R, W>> | Prepared<R, W>;
  create: (id: string, fields: W) => Promise<R>;
  update: (id: string, fields: W) => Promise<R>;
  audit: {
    create: AuditAction;
    update: AuditAction;
    /** Records as the code actor. */
    auditor: Auditor<R>;
  };
}

/** What a declaration turns into, or the reason it cannot. */
type Prepared<R, W> = ResourcePlan<R, W> | { skip: string };

interface ResourcePlan<R, W> {
  /** Written on update; the basis of a create. */
  desired: W;
  same: (current: R) => boolean;
  /** Create-only fields a sync never writes back. */
  onCreate?: Partial<W>;
  /** Note shown with `created`. */
  reason?: string;
}

/**
 * Reconciles one-row-per-declaration kinds (credentials, and kinds like endpoints and
 * workflows). Templates are separate: one declaration spans a row per locale.
 */
export async function reconcile<D, R extends { id: string }, W extends object>(
  space: SpaceRow,
  declared: D[],
  options: SyncOptions,
  spec: ResourceReconciler<D, R, W>,
): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  const existing = spec.rows;
  const byKey = new Map(existing.map((row) => [spec.rowKey(row), row]));
  // Written rows replace their in-memory copy, so later phases see this pass's writes.
  const keep = (row: R) => {
    const index = existing.findIndex((candidate) => candidate.id === row.id);
    if (index < 0) existing.push(row);
    else existing[index] = row;
  };

  for (const definition of declared) {
    const id = spec.id(definition);
    const current = byKey.get(spec.key(definition));
    const change = (action: SyncAction, reason?: string): SyncChange =>
      entry(spec.kind, spec.slug(definition), space, action, reason);

    // Same slug but a different id: not ours, never taken over.
    if (current && current.id !== id) {
      changes.push(change('skipped', spec.taken));
      continue;
    }

    const planned = await spec.prepare(definition, current);
    if ('skip' in planned) {
      changes.push(change('skipped', planned.skip));
      continue;
    }

    if (!current) {
      changes.push(change('created', planned.reason));
      if (!options.dryRun) {
        const row = await spec.create(id, { ...planned.desired, ...planned.onCreate });
        keep(row);
        await spec.audit.auditor.record(spec.audit.create, row);
      }
      continue;
    }

    if (planned.same(current)) {
      changes.push(change('unchanged'));
      continue;
    }
    changes.push(change('updated'));
    if (!options.dryRun) {
      const row = await spec.update(id, planned.desired);
      keep(row);
      await spec.audit.auditor.record(spec.audit.update, row);
    }
  }
  return changes;
}
