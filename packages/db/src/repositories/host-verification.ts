import { and, asc, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** The verification columns every table of host names has. */
export interface HostVerificationData {
  verifiedAt: Date | null;
  verificationToken: string | null;
  verificationStartedAt: Date | null;
  verificationCheckedAt: Date | null;
  verificationFailedAt: Date | null;
}

/** A table of host names with the verification columns. */
export type VerifiedTable = Record<
  | 'verifiedAt'
  | 'verificationToken'
  | 'verificationStartedAt'
  | 'verificationCheckedAt'
  | 'verificationFailedAt',
  PgColumn
>;

/** Unverified rows with a token whose window is still open. */
export function pendingVerification(table: VerifiedTable): SQL | undefined {
  return and(
    isNull(table.verifiedAt),
    isNull(table.verificationFailedAt),
    isNotNull(table.verificationToken),
  );
}

/** Least recently checked first. */
export function checkOrder(table: VerifiedTable): SQL {
  return asc(sql`coalesce(${table.verificationCheckedAt}, ${table.verificationStartedAt})`);
}
