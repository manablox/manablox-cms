import { describe, expect, it } from 'vitest';
import { type AuditRecordInput, type AuditSink, auditor } from '../src/auditor.js';
import { copyName } from '../src/names.js';

function sink(): AuditSink & { entries: AuditRecordInput[] } {
  const entries: AuditRecordInput[] = [];
  return {
    entries,
    audit: {
      record: async (input) => {
        entries.push(input);
      },
    },
  };
}

type Row = { id: string; spaceId: string; name: string; kind: string };
const row: Row = { id: 'r1', spaceId: 's1', name: 'Row', kind: 'k' };

describe('auditor', () => {
  it('builds the entry from the row, leaving out what the call omits', async () => {
    const target = sink();
    await auditor(target, 'menu', (r: Row) => r.name).record('menu.update', row);
    expect(target.entries).toEqual([
      {
        spaceId: 's1',
        action: 'menu.update',
        targetKind: 'menu',
        targetId: 'r1',
        targetLabel: 'Row',
      },
    ]);
    expect(Object.keys(target.entries[0] ?? {})).not.toContain('changes');
    expect(Object.keys(target.entries[0] ?? {})).not.toContain('meta');
  });

  it('passes changes and meta through', () => {
    const audit = auditor(sink(), 'menu', (r: Row) => r.name);
    const changes = [{ path: 'name', from: 'A', to: 'B' }];
    expect(audit.entry('menu.update', row, changes, { note: 1 })).toMatchObject({
      changes,
      meta: { note: 1 },
    });
    expect(audit.entry('menu.update', row, [], null)).not.toHaveProperty('meta');
  });

  it('merges row facts under the call meta, the call winning', () => {
    const audit = auditor(sink(), 'redirect', (r: Row) => r.name, {
      meta: (r) => ({ kind: r.kind, via: 'row' }),
    });
    expect(audit.entry('redirect.create', row).meta).toEqual({ kind: 'k', via: 'row' });
    expect(audit.entry('redirect.create', row, undefined, { via: 'call' }).meta).toEqual({
      kind: 'k',
      via: 'call',
    });
  });

  it('takes the space and actor from the options', () => {
    const actor = { kind: 'system', id: null, label: 'Code' } as const;
    const audit = auditor(sink(), 'space', (r: Row) => r.name, { spaceId: (r) => r.id, actor });
    expect(audit.entry('space.update', row)).toMatchObject({ spaceId: 'r1', actor });
  });

  it('writes through other repositories with `in`', async () => {
    const first = sink();
    const second = sink();
    await auditor(first, 'menu', (r: Row) => r.name)
      .in(second)
      .record('menu.delete', row);
    expect(first.entries).toEqual([]);
    expect(second.entries).toHaveLength(1);
  });
});

describe('copyName', () => {
  it('counts up from the copy suffix', () => {
    expect(copyName('Home')).toBe('Home (copy)');
    expect(copyName('Home (copy)')).toBe('Home (copy 2)');
    expect(copyName('Home (copy 2)')).toBe('Home (copy 3)');
  });

  it('skips taken names', () => {
    expect(copyName('Flow', ['Flow (copy)', 'Flow (copy 2)'])).toBe('Flow (copy 3)');
  });
});
