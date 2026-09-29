import * as definitions from './definitions/index.js';
import { buildTables } from './plugin-tables.js';
import type * as postgresSchema from './schema/tables.js';
import type * as sqliteSchema from './sqlite/schema/index.js';

/** Every core table for Postgres, keyed as repositories use them; built from `./definitions`. */
export const postgresTables = buildTables(definitions, 'postgres');

/** Typed as the Postgres tables; other dialects' tables share their row shapes. */
export type Tables = typeof postgresTables;

// drizzle-kit reads each dialect's tables from named exports (`./schema/tables.ts`,
// `./sqlite/schema/index.ts`); this fails when one misses a definition.
type Missing<T> = Exclude<keyof typeof definitions, keyof T>;
const complete: [Missing<typeof postgresSchema>, Missing<typeof sqliteSchema>] extends [
  never,
  never,
]
  ? true
  : never = true;
void complete;
