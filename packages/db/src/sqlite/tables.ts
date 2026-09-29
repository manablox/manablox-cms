import * as definitions from '../definitions/index.js';
import { buildTables } from '../plugin-tables.js';
import type { Tables } from '../tables.js';

/** The SQLite tables, typed as their Postgres twins; both are built from the same definitions. */
export const sqliteTables: Tables = buildTables(definitions, 'sqlite');
