import { type BuiltTables, buildTables, type DatabaseContext } from '@manablox/db';
import * as tables from './tables.js';

export type WebhookTables = BuiltTables<typeof tables>;

export type WebhookRow = WebhookTables['webhooks']['$inferSelect'];
export type WebhookDeliveryRow = WebhookTables['webhookDeliveries']['$inferSelect'];

/** The webhook tables of a connection or transaction's dialect. */
export const webhookTables = (context: DatabaseContext): WebhookTables =>
  buildTables(tables, context.dialect.name);
