import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { describe, expect, it } from 'vitest';
import { isProxy, reactive, ref } from 'vue';

describe('plainClone', () => {
  it('copies reactive data, including proxies nested in plain objects', () => {
    const state = reactive({ fields: { list: [{ a: 1 }, { b: [2, 3] }] }, title: 'x' });
    const wrapper = { doc: state, fields: state.fields, list: state.fields.list };
    const copy = plainClone(wrapper);

    expect(copy).toEqual({
      doc: { fields: { list: [{ a: 1 }, { b: [2, 3] }] }, title: 'x' },
      fields: { list: [{ a: 1 }, { b: [2, 3] }] },
      list: [{ a: 1 }, { b: [2, 3] }],
    });
    expect(isProxy(copy.doc)).toBe(false);
    expect(isProxy(copy.list[0])).toBe(false);
    expect(() => structuredClone(copy)).not.toThrow();
    copy.doc.fields.list.push({ a: 9 });
    expect(state.fields.list).toHaveLength(2);
  });

  it('unwraps a ref value and keeps dates and undefined', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const source = ref({ at, missing: undefined as string | undefined, n: null });
    const copy = plainClone(source.value);
    // happy-dom's `structuredClone` builds the Date in another realm.
    expect(Object.prototype.toString.call(copy.at)).toBe('[object Date]');
    expect(copy.at).not.toBe(at);
    expect(copy.at.getTime()).toBe(at.getTime());
    expect('missing' in copy).toBe(true);
    expect(copy.n).toBeNull();
  });
});
