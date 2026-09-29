import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useRelationValue } from '~/composables/useRelationValue';

describe('useRelationValue', () => {
  it('reads a single value as a one-item list and hands back a string or null', () => {
    const value = ref<unknown>('a');
    const relation = useRelationValue(value, false);
    expect(relation.ids.value).toEqual(['a']);
    expect(relation.pick('b')).toBe('b');
    expect(relation.remove('a')).toBeNull();
    value.value = null;
    expect(relation.ids.value).toEqual([]);
  });

  it('reads a list and hands back lists without duplicates', () => {
    const relation = useRelationValue(['a', 'b'], true);
    expect(relation.ids.value).toEqual(['a', 'b']);
    expect(relation.pick('c')).toEqual(['a', 'b', 'c']);
    expect(relation.pick('a')).toEqual(['a', 'b']);
    expect(relation.remove('a')).toEqual(['b']);
    expect(useRelationValue('not-a-list', true).ids.value).toEqual([]);
  });
});
