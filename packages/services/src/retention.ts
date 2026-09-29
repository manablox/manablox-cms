import { gzipSync } from 'node:zlib';
import { type AnyRetentionKey, type RetentionKey, retentionControlKey } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {
  AuditEntryRow,
  AuditRetention,
  ControlSettingRow,
  Repositories,
  SpaceRow,
} from '@manablox/db';
import { dataProviders } from './data/registry.js';

const DAY_MS = 24 * 60 * 60_000;

/** Rows per delete statement. */
export const RETENTION_BATCH = 1000;

/** How long one retention run may keep deleting; the rest waits for the next run. */
export const RETENTION_BUDGET_MS = 10 * 60_000;

/** Core's retention keys the maintenance job prunes by; data providers add theirs. */
const PRUNED_KEYS = [
  'versionsDays',
  'auditDays',
  'notificationsDays',
] as const satisfies readonly RetentionKey[];

/** A retention key resolved at the instance and for every space; `null` keeps everything. */
export interface RetentionWindows {
  instance: number | null;
  spaces: Map<string, number | null>;
}

type RetentionHost = Pick<Manablox, 'controls'>;

/** Where audit exports are written; a `StorageDriver` fits. */
export interface AuditExportStorage {
  put(key: string, body: Buffer, options: { contentType: string }): Promise<unknown>;
}

export interface RetentionOptions {
  /** Required while `retention.auditExport` is on. */
  storage?: AuditExportStorage | null | undefined;
  now?: Date | undefined;
  batch?: number | undefined;
  budgetMs?: number | undefined;
}

/** Rows deleted per key. */
export type RetentionReport = Partial<Record<AnyRetentionKey, number>>;

/** The cutoff `days` before `now`. */
export function retentionCutoff(days: number | null, now: Date = new Date()): Date | null {
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

/** Resolves `key` per space; only spaces a group or space value touches are resolved one by one. */
async function windowsOf(
  manablox: RetentionHost,
  spaces: readonly Pick<SpaceRow, 'id' | 'groupId'>[],
  rows: readonly ControlSettingRow[],
  key: AnyRetentionKey,
): Promise<RetentionWindows | null> {
  const stored = rows.filter((row) => row.key === retentionControlKey(key));
  if (stored.length === 0) return null;
  const windowOf = async (spaceId: string | null) =>
    (await manablox.controls.resolved(spaceId)).retention[key] as number | null;
  const instance = await windowOf(null);
  const spaceIds = new Set(stored.filter((row) => row.scopeKind === 'space').map((r) => r.scopeId));
  const groupIds = new Set(stored.filter((row) => row.scopeKind === 'group').map((r) => r.scopeId));
  const out = new Map<string, number | null>();
  for (const space of spaces) {
    const touched =
      spaceIds.has(space.id) || (space.groupId !== null && groupIds.has(space.groupId));
    out.set(space.id, touched ? await windowOf(space.id) : instance);
  }
  return { instance, spaces: out };
}

/** `key` per space; `null` when no scope stores it. */
export async function retentionWindows(
  manablox: RetentionHost,
  repos: Repositories,
  key: AnyRetentionKey,
): Promise<RetentionWindows | null> {
  const rows = await repos.controlSettings.listByKeys([retentionControlKey(key)]);
  if (rows.length === 0) return null;
  return windowsOf(manablox, await repos.spaces.list(), rows, key);
}

/** The audit read filter across every space; `undefined` when no window is set. */
export async function auditRetention(
  manablox: RetentionHost,
  repos: Repositories,
  now: Date = new Date(),
): Promise<AuditRetention | undefined> {
  const windows = await retentionWindows(manablox, repos, 'auditDays');
  if (!windows) return undefined;
  const spaces = new Map<string, Date | null>();
  for (const [spaceId, days] of windows.spaces) {
    if (days !== windows.instance) spaces.set(spaceId, retentionCutoff(days, now));
  }
  return { instance: retentionCutoff(windows.instance, now), spaces };
}

/** One space's audit read filter; `undefined` when it keeps everything. */
export async function spaceAuditRetention(
  manablox: RetentionHost,
  spaceId: string | null,
  now: Date = new Date(),
): Promise<AuditRetention | undefined> {
  const days = (await manablox.controls.resolved(spaceId)).retention.auditDays;
  return days === null ? undefined : { instance: retentionCutoff(days, now) };
}

/** Where a pruned audit batch is exported. */
export function auditExportKey(spaceId: string | null, rows: readonly AuditEntryRow[]): string {
  const stamp = (row: AuditEntryRow | undefined) =>
    (row?.at ?? new Date(0)).toISOString().replaceAll(':', '');
  return `audit-exports/${spaceId ?? 'instance'}/${stamp(rows[0])}-${stamp(rows.at(-1))}.ndjson.gz`;
}

/**
 * Deletes what the retention controls let go, per space in batches of `batch` rows, until
 * done or `budgetMs` has passed. Does nothing when no scope sets a retention key.
 */
export async function pruneRetention(
  manablox: Manablox,
  repos: Repositories,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const pruners = dataProviders(manablox).flatMap((provider) => provider.retention ?? []);
  const keys = [...PRUNED_KEYS, ...pruners.map((pruner) => pruner.key)];
  const rows = await repos.controlSettings.listByKeys(keys.map(retentionControlKey));
  if (rows.length === 0) return {};
  const now = options.now ?? new Date();
  const batch = options.batch ?? RETENTION_BATCH;
  const deadline = Date.now() + (options.budgetMs ?? RETENTION_BUDGET_MS);
  const spaces = await repos.spaces.list();
  const report: RetentionReport = {};

  /** Runs `step` until it deletes less than a batch or the budget is spent. */
  const drain = async (key: AnyRetentionKey, step: () => Promise<number>) => {
    for (;;) {
      if (Date.now() >= deadline) return;
      const removed = await step();
      report[key] = (report[key] ?? 0) + removed;
      if (removed < batch) return;
    }
  };
  /** Each space with a window for `key`, and its cutoff. */
  const eachSpace = async (
    key: AnyRetentionKey,
    fn: (spaceId: string, days: number) => Promise<void>,
  ) => {
    const windows = await windowsOf(manablox, spaces, rows, key);
    if (!windows) return;
    for (const [spaceId, days] of windows.spaces) {
      if (days !== null) await fn(spaceId, days);
    }
  };
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);

  await eachSpace('versionsDays', (spaceId, days) =>
    drain('versionsDays', () => repos.content.pruneVersions(spaceId, cutoff(days), batch)),
  );
  for (const pruner of pruners) {
    await eachSpace(pruner.key, (spaceId, value) =>
      drain(pruner.key, () => pruner.prune({ manablox, repos, spaceId, limit: batch }, value)),
    );
  }
  if (rows.some((row) => row.key === retentionControlKey('notificationsDays'))) {
    const days = (await manablox.controls.resolved(null)).retention.notificationsDays;
    if (days !== null) {
      await drain('notificationsDays', () => repos.notifications.pruneBefore(cutoff(days), batch));
    }
  }

  const audit = await windowsOf(manablox, spaces, rows, 'auditDays');
  if (audit) {
    const exporting = (await manablox.controls.resolved(null)).retention.auditExport;
    const storage = options.storage ?? null;
    if (exporting && !storage) throw new Error('retention.auditExport needs a storage driver');
    const pruneAudit = (spaceId: string | null, days: number) =>
      drain('auditDays', async () => {
        const result = await repos.audit.prune({
          spaceId,
          before: cutoff(days),
          limit: batch,
          beforeDelete:
            exporting && storage
              ? async (pruned) => {
                  const body = gzipSync(`${pruned.map((row) => JSON.stringify(row)).join('\n')}\n`);
                  await storage.put(auditExportKey(spaceId, pruned), body, {
                    contentType: 'application/gzip',
                  });
                }
              : undefined,
        });
        return result?.count ?? 0;
      });
    if (audit.instance !== null) await pruneAudit(null, audit.instance);
    for (const [spaceId, days] of audit.spaces) {
      if (days !== null) await pruneAudit(spaceId, days);
    }
  }
  return report;
}
