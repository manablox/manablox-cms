import { clientId } from '@manablox/admin-sdk/lib/client-id';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { NotificationEvent, RealtimeEvent } from '@manablox/core';
import { dispatchRealtime } from '~/lib/plugins/registry';

/**
 * Live feed: streamed audit entries are buffered briefly, then applied as one union of
 * invalidations. Nothing is replayed; after a gap everything is refetched once.
 */

/** Told when another actor wrote a document; the document editor listens. */
export type ChangedElsewhereListener = (contentId: string, by: string, action: string) => void;
const changedElsewhereListeners = new Set<ChangedElsewhereListener>();

/** Subscribes to writes by other actors; returns the unsubscribe. */
export function onChangedElsewhere(listener: ChangedElsewhereListener): () => void {
  changedElsewhereListeners.add(listener);
  return () => changedElsewhereListeners.delete(listener);
}

/** How long events collect before one flush. */
export const FLUSH_DELAY_MS = 250;

/** Content actions that add or relocate rows, so the whole space refetches. */
const STRUCTURAL = new Set([
  'content.create',
  'content.move',
  'content.duplicate',
  'content.translate',
]);

/** The union of what a batch of events makes stale. */
interface Plan {
  /** Per space: `null` for everything, else the touched documents. */
  content: Map<string | null, Set<string> | null>;
  contentTypes: Set<string | null>;
  assets: Set<string | null>;
  menus: Set<string | null>;
  redirects: Set<string | null>;
  roles: Set<string | null>;
  members: Set<string | null>;
  environments: Set<string | null>;
  /** Spaces whose production a promote rewrote. */
  promoted: Set<string | null>;
  spaces: Set<string | null>;
  users: boolean;
  apiKeys: boolean;
  audit: boolean;
  refreshSession: boolean;
  refreshSpaces: boolean;
  changedElsewhere: { id: string; by: string; action: string }[];
}

const emptyPlan = (): Plan => ({
  content: new Map(),
  contentTypes: new Set(),
  assets: new Set(),
  menus: new Set(),
  redirects: new Set(),
  roles: new Set(),
  members: new Set(),
  environments: new Set(),
  promoted: new Set(),
  spaces: new Set(),
  users: false,
  apiKeys: false,
  audit: false,
  refreshSession: false,
  refreshSpaces: false,
  changedElsewhere: [],
});

/** Adds a document to a space's plan; `null` widens to the whole space. */
function touchContent(plan: Plan, spaceId: string | null, contentId: string | null): void {
  const current = plan.content.get(spaceId);
  if (current === null) return;
  if (contentId === null) {
    plan.content.set(spaceId, null);
    return;
  }
  const ids = current ?? new Set<string>();
  ids.add(contentId);
  plan.content.set(spaceId, ids);
}

function collect(plan: Plan, event: RealtimeEvent, me: string | null): void {
  const spaceId = event.spaceId;
  switch (event.targetKind) {
    case 'content':
      touchContent(
        plan,
        spaceId,
        event.targetId && !STRUCTURAL.has(event.action) ? event.targetId : null,
      );
      // Another tab of the same account counts as elsewhere too.
      if (event.targetId)
        plan.changedElsewhere.push({
          id: event.targetId,
          by: event.actor.label,
          action: event.action,
        });
      break;
    case 'contentType':
      plan.contentTypes.add(spaceId);
      break;
    case 'asset':
      plan.assets.add(spaceId);
      break;
    case 'menu':
      plan.menus.add(spaceId);
      break;
    case 'role':
      plan.roles.add(spaceId);
      // Role grants feed the session's permissions.
      plan.refreshSession = true;
      break;
    case 'redirect':
      plan.redirects.add(spaceId);
      break;
    case 'space':
      plan.spaces.add(spaceId);
      plan.refreshSpaces = true;
      break;
    case 'apiHost':
      plan.spaces.add(spaceId);
      break;
    case 'environment':
      if (event.action === 'environment.promote') {
        plan.promoted.add(spaceId);
        // Home and 404 nominations live on the space row.
        plan.refreshSpaces = true;
      } else {
        plan.environments.add(spaceId);
      }
      break;
    case 'member':
      plan.members.add(spaceId);
      // Own membership changes visible spaces and permissions.
      if (event.targetId === me) {
        plan.refreshSession = true;
        plan.refreshSpaces = true;
      }
      break;
    case 'user':
      plan.users = true;
      if (event.targetId === me) plan.refreshSession = true;
      break;
    case 'apiKey':
      plan.apiKeys = true;
      break;
    default:
      plan.audit = true;
  }
}

/** Invalidates what a batch of events makes stale, each key once. Exported for tests. */
export function applyRemoteChanges(events: readonly RealtimeEvent[]): void {
  const session = useSessionStore();
  const spaces = useSpaceStore();
  const me = session.me?.id ?? null;

  const plan = emptyPlan();
  // The originating tab has already refreshed.
  for (const event of events) {
    if (event.clientId && event.clientId === clientId) continue;
    collect(plan, event, me);
    dispatchRealtime(event);
  }

  for (const [spaceId, ids] of plan.content)
    invalidate.content(spaceId, ids ? [...ids] : undefined);
  for (const spaceId of plan.contentTypes) void invalidate.contentTypes(spaceId);
  for (const spaceId of plan.assets) invalidate.assets(spaceId);
  for (const spaceId of plan.menus) invalidate.menus(spaceId);
  for (const spaceId of plan.redirects) invalidate.redirects(spaceId);
  for (const spaceId of plan.roles) invalidate.roles(spaceId);
  for (const spaceId of plan.members) invalidate.members(spaceId);
  for (const spaceId of plan.environments) invalidate.environments(spaceId);
  for (const spaceId of plan.promoted) invalidate.promoted(spaceId);
  if (plan.spaces.size) {
    invalidate.audit();
    invalidate.spaces(plan.spaces);
  }
  if (plan.users) invalidate.users();
  if (plan.apiKeys) invalidate.apiKeys();
  if (plan.audit) invalidate.audit();
  for (const change of plan.changedElsewhere)
    for (const listener of changedElsewhereListeners) listener(change.id, change.by, change.action);

  if (plan.refreshSession) {
    void session.refresh().then(() => (plan.refreshSpaces ? spaces.refresh() : undefined));
  } else if (plan.refreshSpaces) {
    void spaces.refresh();
  }
}

let pending: RealtimeEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Applies the buffered events now. Exported for tests. */
export function flushRemoteChanges(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  applyRemoteChanges(batch);
}

/** Buffers an event; the batch applies after `FLUSH_DELAY_MS`. */
export function queueRemoteChange(event: RealtimeEvent): void {
  pending.push(event);
  flushTimer ??= setTimeout(flushRemoteChanges, FLUSH_DELAY_MS);
}

/** Refetches the inbox and toasts; content notifications also refetch documents. */
export function applyNotification(event: NotificationEvent): void {
  invalidate.notifications();
  if (event.kind.startsWith('content.')) invalidate.content(event.spaceId);
  toast.info(event.title);
}

/** Refetches everything after a gap in the stream. */
function refetchAll(): void {
  void queryClient.invalidateQueries();
  void useSpaceStore().refresh();
}

let source: EventSource | null = null;
let hadGap = false;

/** Opens the stream; idempotent. The browser reconnects on its own. */
export function connect(): void {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/realtime/events', { withCredentials: true });

  source.addEventListener('ready', () => {
    if (hadGap) refetchAll();
    hadGap = false;
  });
  source.addEventListener('change', (message) => {
    try {
      queueRemoteChange(JSON.parse((message as MessageEvent<string>).data) as RealtimeEvent);
    } catch {
      // Skip a malformed event.
    }
  });
  source.addEventListener('notification', (message) => {
    try {
      applyNotification(JSON.parse((message as MessageEvent<string>).data) as NotificationEvent);
    } catch {
      // Skip a malformed event.
    }
  });
  source.addEventListener('error', () => {
    // Fires on every drop; the next `ready` refetches.
    hadGap = true;
  });
}

export function disconnect(): void {
  source?.close();
  source = null;
  hadGap = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
}
