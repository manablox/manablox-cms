/** The SQLite tables, for drizzle-kit. */
import { sqliteTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const webhooks = sqliteTable(tables.webhooks);
export const webhookDeliveries = sqliteTable(tables.webhookDeliveries);
