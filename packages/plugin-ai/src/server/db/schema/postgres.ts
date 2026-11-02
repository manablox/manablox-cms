/** The Postgres tables, for drizzle-kit. */
import { postgresTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const aiProviders = postgresTable(tables.aiProviders);
export const aiGenerations = postgresTable(tables.aiGenerations);
