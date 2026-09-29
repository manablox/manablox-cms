import type { Scope } from '@manablox/core';
import type { CredentialService } from '@manablox/services';
import type { WebhookAuth, WebhookDirection, WebhookMethod, WebhookPayload } from '../../../sdk.js';
import type { WebhookRow } from '../../db/index.js';

export interface WebhookDelivery {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  attempt?: number | undefined;
}

/** Unvalidated webhook input from the editor. */
export interface WebhookInput {
  direction: WebhookDirection;
  name: string;
  slug?: string | undefined;
  description?: string | null | undefined;
  url?: string | undefined;
  events?: string[] | undefined;
  headers?: Array<{ name: string; value: string }> | undefined;
  methods?: WebhookMethod[] | undefined;
  auth?: Partial<WebhookAuth> | undefined;
  enabled?: boolean | undefined;
}

export interface IncomingCall {
  method: string;
  /** Raw body; signatures cover the original bytes. */
  raw: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

export interface IncomingResult {
  webhook: { id: string; name: string; slug: string };
  deliveryId: string;
  /** Runs the call started. */
  runIds: string[];
  /** Runs the call aborted. */
  abortedRunIds: string[];
}

/**
 * What acts on incoming calls besides the `webhooks:received` hook, such as the workflows
 * waiting on them; without one calls are verified, logged and handed to the hook only.
 */
export interface IncomingWebhookListener {
  /** Aborts, then starts, what listens on the endpoint; the ids of the runs aborted and started. */
  received(
    webhook: WebhookRow,
    payload: WebhookPayload,
    headers: Record<string, string>,
  ): Promise<{ runIds: string[]; abortedRunIds: string[] }>;
  /** How many enabled listeners each incoming endpoint of the environment has, by id. */
  counts(scope: Scope): Promise<Map<string, number>>;
}

export interface WebhookServiceOptions {
  /** Queues outgoing deliveries at once; the plugin wires it to its `deliver` job. */
  enqueue: (deliveries: readonly WebhookDelivery[]) => Promise<void>;
  /** The core vault; only a management instance has one. */
  credentials?: CredentialService | undefined;
  listener?: IncomingWebhookListener | null | undefined;
  fetch?: typeof fetch | undefined;
  now?: (() => Date) | undefined;
}
