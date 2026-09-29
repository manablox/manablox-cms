import type {
  WorkflowPlaceholderHint,
  WorkflowTriggerValue,
} from '@manablox/plugin-workflows/admin-slots';
import type { WebhookView } from '../../sdk';

/** A webhook trigger or abort trigger as the editor holds it. */
export type WebhookTriggerValue = WorkflowTriggerValue & { webhookId: string | null };

/** The kind's catalogue entry: the space's incoming endpoints. */
export const webhooksOf = (catalog: unknown): WebhookView[] =>
  Array.isArray(catalog) ? (catalog as WebhookView[]) : [];

/** The endpoint with `id`, or every endpoint when `id` is null. */
export const webhookOf = (catalog: unknown, id: string | null): WebhookView[] => {
  const hooks = webhooksOf(catalog);
  return id === null ? hooks : hooks.filter((hook) => hook.id === id);
};

/** What templates may read from a call. */
export const WEBHOOK_HINTS: WorkflowPlaceholderHint[] = [
  { path: 'payload.body', hint: 'What arrived, parsed - the usual thing to read' },
  { path: 'payload.body.<name>', hint: 'One value out of the body' },
  { path: 'payload.query.<name>', hint: 'A value from the query string' },
  { path: 'payload.method', hint: 'GET, POST, ...' },
  { path: 'headers.<name>', hint: 'A request header, lower-cased' },
  { path: 'webhook.name', hint: 'The endpoint that was called' },
  { path: 'webhook.slug', hint: '' },
];
