import { type AuditSink, auditor, type PluginAudit } from '@manablox/core';
import { CODE_ACTOR } from '@manablox/services';
import type { WebhookRow } from './db/index.js';

/** The audit entity of endpoints. */
export const WEBHOOK_ENTITY = 'webhooks.webhook';

/** Endpoints in the activity log, incoming calls included. */
export const webhookAudit: PluginAudit = { entities: [WEBHOOK_ENTITY] };

/** Endpoint entries carry the direction and auth mode, never secrets. */
export const webhookAuditor = (sink: AuditSink) =>
  auditor(sink, WEBHOOK_ENTITY, (row: WebhookRow) => row.name, {
    meta: (row) => ({ direction: row.direction, authMode: row.authMode }),
  });

/** Incoming calls, without the endpoint facts the webhook auditor adds. */
export const receiptAuditor = (sink: AuditSink) =>
  auditor(sink, WEBHOOK_ENTITY, (row: WebhookRow) => row.name);

/** Entries of the code resource sync, written as the code actor. */
export const codeWebhookAuditor = (sink: AuditSink) =>
  auditor(sink, WEBHOOK_ENTITY, (row: WebhookRow) => row.name, { actor: CODE_ACTOR });
