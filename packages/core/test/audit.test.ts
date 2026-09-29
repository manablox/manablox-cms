import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_VALUE_LIMIT,
  canonicalJson,
  diffRecords,
  snapshotChanges,
} from '../src/audit.js';
import { currentActor, hashAuditEntry, runAsActor, SYSTEM_ACTOR } from '../src/entries/node.js';

describe('canonicalJson', () => {
  it('serialises the same object the same way whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }),
    );
  });

  it('drops undefined members and writes dates as ISO strings', () => {
    const at = new Date('2026-09-06T10:00:00.000Z');
    expect(canonicalJson({ at, gone: undefined })).toBe('{"at":"2026-09-06T10:00:00.000Z"}');
  });
});

describe('diffRecords', () => {
  it('reports each changed key with both values, ignoring the counters a write bumps', () => {
    const before = { title: 'A', slug: 'a', version: 1, updatedAt: new Date(1) };
    const after = { title: 'B', slug: 'a', version: 2, updatedAt: new Date(2) };
    expect(diffRecords(before, after)).toEqual([{ path: 'title', from: 'A', to: 'B' }]);
  });

  it('compares an expanded key one level down, so a document names the field', () => {
    const before = { fields: { body: 'x', hero: 'h' }, title: 'T' };
    const after = { fields: { body: 'y', hero: 'h', extra: 1 }, title: 'T' };
    expect(diffRecords(before, after, { expand: ['fields'] })).toEqual([
      { path: 'fields.body', from: 'x', to: 'y' },
      { path: 'fields.extra', from: undefined, to: 1 },
    ]);
  });

  it('keeps a note of the size instead of a value too large to store', () => {
    const big = 'x'.repeat(AUDIT_VALUE_LIMIT + 1);
    expect(diffRecords({ body: 'small' }, { body: big })).toEqual([
      { path: 'body', from: 'small', to: { $truncated: true, length: big.length + 2 } },
    ]);
  });

  it('snapshots a creation as changes from nothing and a deletion as changes to nothing', () => {
    expect(snapshotChanges({ name: 'Main', createdAt: new Date() }, 'created')).toEqual([
      { path: 'name', from: undefined, to: 'Main' },
    ]);
    expect(snapshotChanges({ name: 'Main' }, 'deleted')).toEqual([
      { path: 'name', from: 'Main', to: undefined },
    ]);
  });
});

describe('the actor context', () => {
  it('is the system outside any request and the given actor inside one, across awaits', async () => {
    expect(currentActor()).toBe(SYSTEM_ACTOR);
    const actor = { kind: 'user' as const, id: 'u1', label: 'a@example.com' };
    const seen = await runAsActor(actor, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentActor();
    });
    expect(seen).toBe(actor);
    expect(currentActor()).toBe(SYSTEM_ACTOR);
  });

  it('lets an inner run override the outer one, as a plugin run does inside a request', async () => {
    const outer = { kind: 'user' as const, id: 'u1', label: 'a@example.com' };
    const inner = { kind: 'hello' as const, id: 'r1', label: 'Notify' };
    await runAsActor(outer, async () => {
      expect(await runAsActor(inner, async () => currentActor())).toBe(inner);
      expect(currentActor()).toBe(outer);
    });
  });
});

describe('hashAuditEntry', () => {
  const entry = {
    at: new Date('2026-09-06T10:00:00.000Z'),
    spaceId: null,
    actorKind: 'user' as const,
    actorId: 'u1',
    actorLabel: 'a@example.com',
    actorDetail: null,
    action: 'content.update',
    targetKind: 'content',
    targetId: 'c1',
    targetLabel: 'Home',
    changes: [{ path: 'title', from: 'A', to: 'B' }],
    meta: null,
    prevHash: null,
  };

  it('is stable for the same content and differs once anything in it changes', () => {
    expect(hashAuditEntry(entry)).toBe(hashAuditEntry({ ...entry }));
    expect(hashAuditEntry({ ...entry, targetLabel: 'Start' })).not.toBe(hashAuditEntry(entry));
    expect(hashAuditEntry({ ...entry, prevHash: 'abc' })).not.toBe(hashAuditEntry(entry));
  });
});

describe('the action catalogue', () => {
  it('has a label for every action', () => {
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
  });
});
