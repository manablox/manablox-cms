import { describe, expect, it } from 'vitest';
import { defineContentType } from '../src/content-type.js';
import {
  compactNotificationPreferences,
  NOTIFICATION_KIND_INFO,
  NOTIFICATION_KIND_LIST,
  NOTIFICATION_KINDS,
  resolveNotificationPreferences,
} from '../src/notification.js';

describe('notification preferences', () => {
  it('resolves every kind to the catalogue default when nothing is stored', () => {
    const resolved = resolveNotificationPreferences(null);
    for (const kind of NOTIFICATION_KINDS) {
      expect(resolved[kind]).toEqual(NOTIFICATION_KIND_INFO[kind].defaults);
    }
  });

  it('lays a stored override over the default, channel by channel', () => {
    const resolved = resolveNotificationPreferences({
      'content.approved': { email: false },
    });
    expect(resolved['content.approved']).toEqual({ inApp: true, email: false, push: true });
    expect(resolved['content.rejected']).toEqual(
      NOTIFICATION_KIND_INFO['content.rejected'].defaults,
    );
  });

  it('compacts a full table down to what differs from the defaults', () => {
    const resolved = resolveNotificationPreferences(null);
    resolved['member.granted'].inApp = false;
    resolved['content.approvalWithdrawn'].email = true;
    expect(compactNotificationPreferences(resolved)).toEqual({
      'member.granted': { inApp: false },
      'content.approvalWithdrawn': { email: true },
    });
  });

  it('compacts a table back to nothing once every choice is the default again', () => {
    expect(compactNotificationPreferences(resolveNotificationPreferences(null))).toEqual({});
  });

  it('lists every kind once with its label, for the preferences form', () => {
    expect(NOTIFICATION_KIND_LIST.map((kind) => kind.id)).toEqual([...NOTIFICATION_KINDS]);
    for (const kind of NOTIFICATION_KIND_LIST) expect(kind.label).not.toBe('');
  });
});

describe('defineContentType and requiresApproval', () => {
  it('defaults to no review', () => {
    expect(defineContentType({ name: 'page', fields: [] }).requiresApproval).toBe(false);
  });

  it('keeps the flag on a publishable type', () => {
    expect(
      defineContentType({ name: 'page', requiresApproval: true, fields: [] }).requiresApproval,
    ).toBe(true);
  });

  it('drops the flag on a type that never publishes: there is nothing to approve', () => {
    expect(
      defineContentType({ name: 'page', isPublishable: false, requiresApproval: true, fields: [] })
        .requiresApproval,
    ).toBe(false);
  });

  it('refuses the flag on a block type like the other document flags', () => {
    expect(() =>
      defineContentType({ name: 'teaser', kind: 'block', requiresApproval: true, fields: [] }),
    ).toThrow();
  });
});
