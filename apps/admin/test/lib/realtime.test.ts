import type { NotificationEvent, RealtimeEvent } from '@manablox/core';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invalidate = vi.hoisted(() => ({
  content: vi.fn(),
  contentTypes: vi.fn(() => Promise.resolve()),
  assets: vi.fn(),
  menus: vi.fn(),
  redirects: vi.fn(),
  roles: vi.fn(),
  members: vi.fn(),
  environments: vi.fn(),
  promoted: vi.fn(),
  spaces: vi.fn(),
  users: vi.fn(),
  apiKeys: vi.fn(),
  audit: vi.fn(),
  notifications: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn(() => Promise.resolve()) }));
const api = vi.hoisted(() => ({
  spaces: { list: vi.fn(async () => []) },
  users: { me: vi.fn(async () => ({ id: 'u-me', role: 'editor', spaces: {}, permissions: {} })) },
}));

vi.mock('@manablox/admin-sdk/lib/invalidate', () => ({ invalidate }));
vi.mock('@manablox/admin-sdk/lib/query-client', () => ({ queryClient }));
vi.mock('@manablox/admin-sdk/lib/client-id', () => ({ clientId: 'this-tab' }));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api }));
vi.mock('@manablox/admin-sdk/lib/toast', () => ({ toast }));
vi.mock('@manablox/admin-sdk/features/content/queries', () => ({ content: {} }));
vi.mock('@manablox/admin-sdk/features/content-types/queries', () => ({
  fetchContentTypes: vi.fn(),
  fetchFieldTypes: vi.fn(),
  useContentTypes: () => ({ data: { value: [] } }),
  useFieldTypes: () => ({ data: { value: [] } }),
}));

import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useDraftStore } from '~/features/content/useDraftStore';
import {
  applyNotification,
  applyRemoteChanges,
  FLUSH_DELAY_MS,
  flushRemoteChanges,
  queueRemoteChange,
} from '~/lib/realtime';

const event = (over: Partial<RealtimeEvent>): RealtimeEvent => ({
  id: 'e1',
  seq: 1,
  at: '2026-01-01T00:00:00.000Z',
  spaceId: 'space-1',
  action: 'content.update',
  targetKind: 'content',
  targetId: 'doc-1',
  targetLabel: 'Home',
  actor: { kind: 'user', id: 'u-alice', label: 'alice@example.com' },
  clientId: 'other-tab',
  ...over,
});

const applyRemoteChange = (single: RealtimeEvent) => applyRemoteChanges([single]);

describe('applyRemoteChanges', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("ignores the echo of this tab's own write", () => {
    applyRemoteChange(event({ clientId: 'this-tab' }));
    expect(invalidate.content).not.toHaveBeenCalled();
  });

  it("refetches a space's environments, and everything after a promote", () => {
    applyRemoteChange(event({ action: 'environment.create', targetKind: 'environment' }));
    expect(invalidate.environments).toHaveBeenCalledWith('space-1');
    expect(invalidate.promoted).not.toHaveBeenCalled();
    applyRemoteChange(event({ action: 'environment.promote', targetKind: 'environment' }));
    expect(invalidate.promoted).toHaveBeenCalledWith('space-1');
  });

  it('narrows a content update to the changed document', () => {
    applyRemoteChange(event({}));
    expect(invalidate.content).toHaveBeenCalledWith('space-1', ['doc-1']);
  });

  it('refetches the whole space when rows are added or moved, or the target is unknown', () => {
    applyRemoteChange(event({ action: 'content.create' }));
    applyRemoteChange(event({ action: 'content.move' }));
    applyRemoteChange(event({ action: 'content.update', targetId: null }));
    expect(invalidate.content).toHaveBeenCalledTimes(3);
    for (const call of invalidate.content.mock.calls) expect(call).toEqual(['space-1', undefined]);
  });

  it('applies the union of a batch: one call per space, every touched document at once', () => {
    applyRemoteChanges([
      event({ targetId: 'doc-1' }),
      event({ targetId: 'doc-2', action: 'content.publish' }),
      event({ targetId: 'doc-1' }),
      event({ targetId: 'doc-9', spaceId: 'space-2' }),
      event({ targetKind: 'asset' }),
      event({ targetKind: 'asset' }),
    ]);
    expect(invalidate.content).toHaveBeenCalledTimes(2);
    expect(invalidate.content).toHaveBeenCalledWith('space-1', ['doc-1', 'doc-2']);
    expect(invalidate.content).toHaveBeenCalledWith('space-2', ['doc-9']);
    expect(invalidate.assets).toHaveBeenCalledTimes(1);
  });

  it('widens to the whole space once any event in the batch is structural', () => {
    applyRemoteChanges([
      event({ targetId: 'doc-1' }),
      event({ action: 'content.create', targetId: 'doc-3' }),
      event({ targetId: 'doc-2' }),
    ]);
    expect(invalidate.content).toHaveBeenCalledTimes(1);
    expect(invalidate.content).toHaveBeenCalledWith('space-1', undefined);
  });

  it('flags the open document when someone else saves or deletes it', () => {
    const draft = useDraftStore();
    draft.open({
      id: 'doc-1',
      spaceId: 'space-1',
      typeId: 't',
      locale: 'en',
      parentId: null,
      title: 'Home',
      slug: 'home',
      fields: {},
      position: 0,
      version: 1,
      tags: [],
    });
    applyRemoteChange(event({ targetId: 'doc-2' }));
    expect(draft.changedElsewhere).toBeNull();
    applyRemoteChange(event({ action: 'content.delete' }));
    expect(draft.changedElsewhere).toEqual({ by: 'alice@example.com', action: 'content.delete' });
  });

  it('maps each kind of target to the invalidation its write would have made', () => {
    applyRemoteChange(event({ targetKind: 'contentType' }));
    applyRemoteChange(event({ targetKind: 'asset' }));
    applyRemoteChange(event({ targetKind: 'menu' }));
    applyRemoteChange(event({ targetKind: 'apiKey', spaceId: null }));
    applyRemoteChange(event({ targetKind: 'session', spaceId: null }));
    expect(invalidate.contentTypes).toHaveBeenCalledWith('space-1');
    expect(invalidate.assets).toHaveBeenCalledWith('space-1');
    expect(invalidate.menus).toHaveBeenCalledWith('space-1');
    expect(invalidate.apiKeys).toHaveBeenCalled();
    expect(invalidate.audit).toHaveBeenCalledTimes(1);
  });

  it('refetches the redirects of a space for redirect writes', () => {
    applyRemoteChanges([
      event({ targetKind: 'redirect', action: 'redirect.update', spaceId: 'space-2' }),
    ]);
    expect(invalidate.redirects).toHaveBeenCalledWith('space-2');
  });

  it('reloads the space list for a space change and the session for my own membership', async () => {
    const session = useSessionStore();
    await session.refresh();
    api.users.me.mockClear();

    applyRemoteChange(event({ targetKind: 'space' }));
    expect(api.spaces.list).toHaveBeenCalledTimes(1);

    applyRemoteChange(event({ targetKind: 'member', targetId: 'u-someone' }));
    expect(api.users.me).not.toHaveBeenCalled();
    applyRemoteChange(event({ targetKind: 'member', targetId: 'u-me' }));
    expect(api.users.me).toHaveBeenCalledTimes(1);
    expect(invalidate.members).toHaveBeenCalledTimes(2);
  });
});

describe('queueRemoteChange', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    flushRemoteChanges();
    vi.useRealTimers();
  });

  it('holds events for the flush delay, then applies them together', () => {
    queueRemoteChange(event({ targetId: 'doc-1' }));
    queueRemoteChange(event({ targetId: 'doc-2' }));
    expect(invalidate.content).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 1);
    queueRemoteChange(event({ targetKind: 'menu' }));
    expect(invalidate.content).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidate.content).toHaveBeenCalledTimes(1);
    expect(invalidate.content).toHaveBeenCalledWith('space-1', ['doc-1', 'doc-2']);
    expect(invalidate.menus).toHaveBeenCalledTimes(1);
  });

  it('starts a new window for events after a flush', () => {
    queueRemoteChange(event({ targetId: 'doc-1' }));
    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    queueRemoteChange(event({ targetId: 'doc-2' }));
    expect(invalidate.content).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(invalidate.content).toHaveBeenCalledTimes(2);
    expect(invalidate.content).toHaveBeenLastCalledWith('space-1', ['doc-2']);
  });
});

describe('applyNotification', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const notification = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
    id: 'n1',
    userId: 'u-me',
    kind: 'content.approvalRequested',
    title: '"Home" is waiting for your approval',
    body: '',
    url: '/content/doc-1',
    spaceId: 'space-1',
    at: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it("refreshes the inbox, says what arrived, and refetches the space's documents for a review", () => {
    applyNotification(notification());
    expect(invalidate.notifications).toHaveBeenCalled();
    expect(invalidate.content).toHaveBeenCalledWith('space-1');
    expect(toast.info).toHaveBeenCalledWith('"Home" is waiting for your approval');
  });

  it('leaves the documents alone for a notification about something else', () => {
    applyNotification(notification({ kind: 'member.granted', spaceId: 'space-2' }));
    expect(invalidate.notifications).toHaveBeenCalled();
    expect(invalidate.content).not.toHaveBeenCalled();
  });
});
