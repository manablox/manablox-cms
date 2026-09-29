import { describe, expect, it } from 'vitest';
import { intersectGrants, normaliseGrants, parseGrant } from '../src/permissions.js';

const T1 = 'type-1';
const T2 = 'type-2';

describe('normaliseGrants', () => {
  it('keeps catalogued grants and typed content grants for known types, marks the rest', () => {
    const result = normaliseGrants(
      ['content:write', `content:read:${T1}`, `content:read:${T2}`, 'nope', `asset:read:${T1}`],
      new Set([T1]),
      ['space:read'],
    );
    expect(result.permissions).toEqual(['space:read', 'content:write', `content:read:${T1}`]);
    expect(result.unknown).toEqual([
      { index: 2, grant: `content:read:${T2}` },
      { index: 3, grant: 'nope' },
      { index: 4, grant: `asset:read:${T1}` },
    ]);
  });

  it('takes a grant apart', () => {
    expect(parseGrant('asset:read')).toEqual({ permission: 'asset:read', typeId: null });
    expect(parseGrant(`content:publish:${T1}`)).toEqual({
      permission: 'content:publish',
      typeId: T1,
    });
    expect(parseGrant(`asset:read:${T1}`)).toBeNull();
  });
});

describe('intersectGrants', () => {
  it('keeps only what both sides cover', () => {
    expect(intersectGrants(['space:read', 'asset:read'], ['asset:read', 'asset:write'])).toEqual([
      'asset:read',
    ]);
  });

  it('narrows a broad content grant on either side to the typed grants on the other', () => {
    // Held for every type, allowed for one: the one.
    expect(intersectGrants(['content:write'], [`content:write:${T1}`])).toEqual([
      `content:write:${T1}`,
    ]);
    // Held for one, allowed for every type: still the one.
    expect(intersectGrants([`content:write:${T1}`], ['content:write'])).toEqual([
      `content:write:${T1}`,
    ]);
    // Held for one, allowed for another: nothing.
    expect(intersectGrants([`content:write:${T1}`], [`content:write:${T2}`])).toEqual([]);
  });
});
