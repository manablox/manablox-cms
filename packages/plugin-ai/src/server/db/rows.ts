import { type BuiltTables, buildTables, type DatabaseContext } from '@manablox/db';
import * as tables from './tables.js';

export type AiTables = BuiltTables<typeof tables>;

export type AiProviderRow = AiTables['aiProviders']['$inferSelect'];
export type AiGenerationRow = AiTables['aiGenerations']['$inferSelect'];

/** The AI tables of a connection or transaction's dialect. */
export const aiTables = (context: DatabaseContext): AiTables =>
  buildTables(tables, context.dialect.name);
