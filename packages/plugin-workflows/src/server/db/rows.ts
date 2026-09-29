import { type BuiltTables, buildTables, type DatabaseContext } from '@manablox/db';
import * as tables from './tables.js';

export type WorkflowTables = BuiltTables<typeof tables>;

export type WorkflowRow = WorkflowTables['workflows']['$inferSelect'];
export type WorkflowVersionRow = WorkflowTables['workflowVersions']['$inferSelect'];
export type WorkflowRunRow = WorkflowTables['workflowRuns']['$inferSelect'];

/** The workflow tables of a connection or transaction's dialect. */
export const workflowTables = (context: DatabaseContext): WorkflowTables =>
  buildTables(tables, context.dialect.name);
