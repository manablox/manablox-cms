import { describe, expect, it } from 'vitest';
import { isProxy, reactive, readonly } from 'vue';
import { jsonEqual, plainCopier } from '../../src/admin/model/plain-data';

describe('jsonEqual', () => {
  const cases: Array<[unknown, unknown]> = [
    [
      { a: 1, b: [1, 2] },
      { a: 1, b: [1, 2] },
    ],
    [
      { a: 1, b: 2 },
      { b: 2, a: 1 },
    ],
    [{ a: 1, b: undefined }, { a: 1 }],
    [{ a: () => 1 }, {}],
    [[undefined], [null]],
    [
      [1, 2],
      [1, 2, 3],
    ],
    [{ a: Number.NaN }, { a: null }],
    [{ a: new Date(0) }, { a: new Date(0).toISOString() }],
    [null, undefined],
    [{ a: '1' }, { a: 1 }],
    [{ a: {} }, { a: [] }],
    [{ a: { b: { c: 'x' } } }, { a: { b: { c: 'y' } } }],
  ];

  it('agrees with comparing JSON strings', () => {
    for (const [a, b] of cases) {
      expect(jsonEqual(a, b), JSON.stringify([a, b])).toBe(
        JSON.stringify(a ?? null) === JSON.stringify(b ?? null),
      );
    }
  });

  it('does not walk parts both values share', () => {
    const shared = {};
    Object.defineProperty(shared, 'x', {
      enumerable: true,
      get: () => {
        throw new Error('walked');
      },
    });
    expect(jsonEqual({ a: shared, b: 1 }, { a: shared, b: 1 })).toBe(true);
    expect(jsonEqual({ a: shared, b: 1 }, { a: shared, b: 2 })).toBe(false);
  });
});

describe('plainCopier', () => {
  it('unwraps proxies and keeps plain parts as they are', () => {
    const copy = plainCopier();
    const plain = { text: 'a', nested: { list: [1, 2] } };
    const types = reactive([{ id: 't1', fields: [{ name: 'title' }] }]);
    const rows = readonly(reactive({ list: [{ key: 'k', data: { root: { id: 'r' } } }] }));
    const input = { plain, types, rows: rows.list, when: new Date(0) };

    const out = copy(input);
    expect(out).not.toBe(input);
    expect(out.plain).toBe(plain);
    expect(isProxy(out.types)).toBe(false);
    expect(isProxy(out.types[0])).toBe(false);
    expect(isProxy(out.rows[0]?.data)).toBe(false);
    expect(out.when).not.toBe(input.when);
    expect(JSON.stringify(out)).toBe(JSON.stringify(input));
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('copies an edited design along the new objects only', () => {
    const copy = plainCopier();
    const types = reactive([{ id: 't1' }]);
    const kept = { id: 'kept', children: [{ id: 'leaf' }] };
    const first = copy({ types, page: { root: { id: 'root', children: [kept] } } });
    const edited = { root: { id: 'root', label: 'x', children: [kept] } };
    const second = copy({ types, page: edited });
    expect(second.types).toBe(first.types);
    expect(second.page).toBe(edited);
    expect(second.page.root.children[0]).toBe(kept);
  });
});
