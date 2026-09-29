/**
 * The content lifecycle events plugins subscribe to (webhooks send them, workflows start on
 * them), and `contentEventHooks`, which turns the content hooks into them.
 */

import { type Scope, scopeOf } from './environment.js';
import type { ContentHookContext, ContentManyHookContext, HookContextBase } from './hook-map.js';
import { onHook, type PluginHookRegistration } from './plugin.js';
import type { ContentRecord } from './types.js';

/** `content.saved` is created or updated. */
export const CONTENT_EVENTS = [
  'content.created',
  'content.updated',
  'content.saved',
  'content.deleted',
  'content.published',
  'content.unpublished',
] as const;
export type ContentEvent = (typeof CONTENT_EVENTS)[number];

/** The events each content event satisfies, itself first. */
export const CONTENT_EVENT_ALIASES: Readonly<Record<ContentEvent, readonly ContentEvent[]>> = {
  'content.created': ['content.created', 'content.saved'],
  'content.updated': ['content.updated', 'content.saved'],
  'content.saved': ['content.saved'],
  'content.deleted': ['content.deleted'],
  'content.published': ['content.published'],
  'content.unpublished': ['content.unpublished'],
};

export const CONTENT_EVENT_LABELS: Record<ContentEvent, { label: string; description: string }> = {
  'content.created': {
    label: 'Created',
    description: 'A new document is saved for the first time.',
  },
  'content.updated': { label: 'Updated', description: 'An existing document is saved again.' },
  'content.saved': { label: 'Saved', description: 'Created or updated - any save.' },
  'content.deleted': { label: 'Deleted', description: 'A document is removed.' },
  'content.published': { label: 'Published', description: 'A document goes live.' },
  'content.unpublished': { label: 'Unpublished', description: 'A document is taken offline.' },
};

/** Where a content event happened, and the hook context it came with. */
export interface ContentEventContext extends HookContextBase {
  spaceId: string;
  /** The rows' environment; the space when there are no rows. */
  scope: Scope;
  /** On `content.updated`: the row before the write. */
  previous?: ContentRecord | null | undefined;
}

/** Gets one content event; deletes and unpublishes of a subtree come as one call. */
export type ContentEventHandler = (
  event: Exclude<ContentEvent, 'content.saved'>,
  rows: readonly ContentRecord[],
  context: ContentEventContext,
) => Promise<void>;

/**
 * Plugin hook registrations that call `handler` with each content event: created, updated
 * and published per row, deleted and unpublished once per operation with all its rows.
 */
export function contentEventHooks(
  handler: ContentEventHandler,
  options: { priority?: number } = {},
): PluginHookRegistration[] {
  const one =
    (event: 'content.created' | 'content.updated' | 'content.published') =>
    (row: ContentRecord, context: ContentHookContext) =>
      handler(event, [row], { ...context, spaceId: row.spaceId, scope: scopeOf(row) });
  const many =
    (event: 'content.deleted' | 'content.unpublished') =>
    (rows: ContentRecord[], context: ContentManyHookContext) =>
      handler(event, rows, {
        ...context,
        scope: rows[0] ? scopeOf(rows[0]) : context.spaceId,
      });
  const { priority } = options;
  return [
    onHook('content:afterCreate', one('content.created'), priority),
    onHook('content:afterUpdate', one('content.updated'), priority),
    onHook('content:afterPublish', one('content.published'), priority),
    onHook('content:afterDeleteMany', many('content.deleted'), priority),
    onHook('content:afterUnpublishMany', many('content.unpublished'), priority),
  ];
}
