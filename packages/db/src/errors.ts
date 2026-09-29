import { type ErrorDetail, type ErrorKey, ManabloxError } from '@manablox/core';

const UNIQUE_CODES = new Set(['23505', 'SQLITE_CONSTRAINT_UNIQUE']);

interface DriverError {
  code?: string;
  extendedCode?: string;
  message?: string;
  cause?: DriverError;
}

/**
 * A unique violation whose message names `constraint`. Postgres names the constraint;
 * SQLite names the columns (`table.column`), or the index for an expression index.
 * Drizzle puts the driver's code and message on `cause`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const outer = error as DriverError | undefined;
  const cause = outer?.cause;
  const codes = [outer?.code, outer?.extendedCode, cause?.code, cause?.extendedCode];
  const detail = `${cause?.message ?? ''} ${outer?.message ?? ''}`;
  return (
    codes.some((code) => code !== undefined && UNIQUE_CODES.has(code)) &&
    detail.includes(constraint)
  );
}

export interface UniqueViolationMapping {
  /** The constraint name, or a distinctive part of it. */
  constraint: string;
  /** The detail reported for the field, e.g. `content.slug.duplicate`. */
  key: ErrorKey;
  path?: (string | number)[];
  params?: Record<string, unknown>;
  /** The error's own key. */
  errorKey: ErrorKey;
}

/** Maps a unique violation to a validation error and rethrows anything else. */
export function rethrowUniqueViolation(error: unknown, mapping: UniqueViolationMapping): never {
  if (!isUniqueViolation(error, mapping.constraint)) throw error;

  const detail: ErrorDetail = {
    key: mapping.key,
    ...(mapping.path ? { path: mapping.path } : {}),
    ...(mapping.params ? { params: mapping.params } : {}),
  };
  throw ManabloxError.validation([detail], mapping.errorKey);
}

/** A per-constraint preset, used as `.catch(taken({ machineName }))`. */
export function uniqueViolation(preset: Omit<UniqueViolationMapping, 'params'>) {
  return (params: Record<string, unknown>) => (error: unknown) =>
    rethrowUniqueViolation(error, { ...preset, params });
}
