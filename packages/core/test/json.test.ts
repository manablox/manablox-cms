import { describe, expect, it } from 'vitest';
import { parseJsonAnswer, parseJsonObject, sameValue } from '../src/json.js';

describe('JSON in model answers', () => {
  it('finds an object or a list in prose and fences', () => {
    expect(parseJsonAnswer('Sure: ```json\n[1, 2]\n``` done')).toEqual([1, 2]);
    expect(parseJsonAnswer('Here {"a": 1} it is')).toEqual({ a: 1 });
    expect(parseJsonAnswer('nothing')).toBeNull();
    expect(parseJsonObject('[{"a": 1}]')).toEqual({ a: 1 });
  });
});

describe('sameValue', () => {
  it('compares deeply, whatever the key order', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameValue({ a: null }, { a: {} })).toBe(false);
  });
});
