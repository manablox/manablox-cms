/** The SQLite tables, for drizzle-kit. */
import { sqliteTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const aiProviders = sqliteTable(tables.aiProviders);
export const aiGenerations = sqliteTable(tables.aiGenerations);
