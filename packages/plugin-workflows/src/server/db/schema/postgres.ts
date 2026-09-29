/** The Postgres tables, for drizzle-kit. */
import { postgresTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const workflows = postgresTable(tables.workflows);
export const workflowVersions = postgresTable(tables.workflowVersions);
export const workflowRuns = postgresTable(tables.workflowRuns);
