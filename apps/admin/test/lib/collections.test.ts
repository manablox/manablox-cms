import {
  moveInList,
  toggleInList,
  toggleInSet,
  withInSet,
} from '@manablox/admin-sdk/lib/collections';
import { describe, expect, it } from 'vitest';

describe('toggleInSet / withInSet', () => {
  it('returns a new set with the key flipped, leaving the input alone', () => {
    const start = new Set(['a']);
    const on = toggleInSet(start, 'b');
    expect([...on]).toEqual(['a', 'b']);
    expect([...toggleInSet(on, 'a')]).toEqual(['b']);
    expect([...start]).toEqual(['a']);
    expect([...withInSet(start, 'a', false)]).toEqual([]);
    expect([...withInSet(start, 'a', true)]).toEqual(['a']);
  });
});

describe('toggleInList', () => {
  it('appends an absent value and removes a present one', () => {
    expect(toggleInList(['x'], 'y')).toEqual(['x', 'y']);
    expect(toggleInList(['x', 'y'], 'x')).toEqual(['y']);
  });
});

describe('moveInList', () => {
  const list = ['a', 'b', 'c', 'd'];
  it('moves an item to the target index', () => {
    expect(moveInList(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInList(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('returns the same list for a no-op or an index outside it', () => {
    expect(moveInList(list, 1, 1)).toBe(list);
    expect(moveInList(list, 0, 4)).toBe(list);
    expect(moveInList(list, 0, -1)).toBe(list);
    expect(moveInList(list, 9, 0)).toBe(list);
  });
});
