/** The SQLite tables, for drizzle-kit. */
import { sqliteTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const workflows = sqliteTable(tables.workflows);
export const workflowVersions = sqliteTable(tables.workflowVersions);
export const workflowRuns = sqliteTable(tables.workflowRuns);
