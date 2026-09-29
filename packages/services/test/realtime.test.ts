import type { ManabloxConfig, RealtimeEvent } from '@manablox/core';
import { Manablox, runAsClient } from '@manablox/core/node';
import { describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/realtime.service.js';

const manablox = new Manablox({
  database: { url: 'postgres://unused' },
  auth: { secret: 'test' },
  fieldTypes: [],
  contentTypes: [],
  logLevel: 'silent',
} as unknown as ManabloxConfig);

const row = {
  id: 'e1',
  seq: 7,
  at: new Date('2026-01-01T00:00:00.000Z'),
  spaceId: 's1',
  action: 'content.update',
  targetKind: 'content',
  targetId: 'c1',
  targetLabel: 'Home',
  actorKind: 'user',
  actorId: 'u1',
  actorLabel: 'alice@example.com',
};

describe('RealtimeService', () => {
  it('tells every subscriber, and stops telling one that unsubscribed', () => {
    const service = new RealtimeService(manablox);
    const heard: string[] = [];
    const stop = service.subscribe((event) => heard.push(`a:${event.id}`));
    service.subscribe((event) => heard.push(`b:${event.id}`));

    service.publishAudit(row);
    stop();
    service.publishAudit({ ...row, id: 'e2' });

    expect(heard).toEqual(['a:e1', 'b:e1', 'b:e2']);
    expect(service.size).toBe(1);
  });

  it('turns the audit row into an event stamped with the originating tab', () => {
    const service = new RealtimeService(manablox);
    const events: RealtimeEvent[] = [];
    service.subscribe((event) => events.push(event));

    runAsClient('tab-1', () => service.publishAudit(row));
    service.publishAudit(row);

    expect(events[0]).toEqual({
      id: 'e1',
      seq: 7,
      at: '2026-01-01T00:00:00.000Z',
      spaceId: 's1',
      action: 'content.update',
      targetKind: 'content',
      targetId: 'c1',
      targetLabel: 'Home',
      actor: { kind: 'user', id: 'u1', label: 'alice@example.com' },
      clientId: 'tab-1',
    });
    // No tab outside a request.
    expect(events[1]?.clientId).toBeNull();
  });

  it('carries on past a listener that throws', () => {
    const service = new RealtimeService(manablox);
    const heard: string[] = [];
    service.subscribe(() => {
      throw new Error('boom');
    });
    service.subscribe((event) => heard.push(event.id));

    expect(() => service.publishAudit(row)).not.toThrow();
    expect(heard).toEqual(['e1']);
  });
});
