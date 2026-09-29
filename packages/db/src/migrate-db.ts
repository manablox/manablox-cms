import type { DatabaseConfig, ManabloxPlugin } from '@manablox/core';
import type { AuditVerification } from './repositories/audit.js';

export interface MigrateDbOptions {
  /** The SQLite database to read. */
  source: DatabaseConfig;
  /** The Postgres URL to write. */
  target: string;
  /** The app role to grant, as migrations do; default: the roles granted before. */
  appRole?: string;
  /** Drops the target's schemas first when it holds rows. */
  replace?: boolean;
  /** Skips the read-only check; the operator guarantees the instance is stopped. */
  forceOffline?: boolean;
  /** How long after the state was set every process has seen it (default 5000 ms). */
  settleMs?: number;
  /** Rows per read and insert (default 1000). */
  batchSize?: number;
  /** Rows per table compared field by field (default 100). */
  sampleSize?: number;
  /** Progress lines. */
  log?: (line: string) => void;
  /** Resolved plugins whose tables are migrated and copied too. */
  plugins?: readonly ManabloxPlugin[];
}

export interface MigrateDbTable {
  name: string;
  source: number;
  target: number;
}

export interface MigrateDbReport {
  tables: MigrateDbTable[];
  audit: { source: AuditVerification; target: AuditVerification };
  /** Rows compared field by field. */
  sampled: number;
  /** Empty when the target matches the source. */
  mismatches: string[];
  ok: boolean;
}

/** Hides the password of a connection URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) return url;
    parsed.password = '***';
    return parsed.href;
  } catch {
    return url.replace(/\/\/[^/]*@/, '//***@');
  }
}

/** A precondition that stops `migrateSqliteToPostgres` before it writes anything. */
export class MigrateDbRefused extends Error {
  override readonly name = 'MigrateDbRefused';
}

/**
 * Copies a SQLite database into a Postgres database migrated to the same schema, then
 * verifies the copy. Throws `MigrateDbRefused` when a precondition fails.
 */
export async function migrateSqliteToPostgres(options: MigrateDbOptions): Promise<MigrateDbReport> {
  const { copySqliteToPostgres } = await import('./sqlite/to-postgres.js');
  return copySqliteToPostgres(options);
}
