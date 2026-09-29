import { describe, expect, it } from 'vitest';
import { batches } from '../src/batch.js';

/** The driver's bind parameter ceiling. */
const MAX_PARAMETERS = 65534;

describe('bulk statement sizing', () => {
  it('yields nothing for no rows', () => {
    expect(batches([], 5)).toEqual([]);
  });

  it('keeps a single statement for a small write', () => {
    const rows = Array.from({ length: 100 }, (_, index) => index);
    expect(batches(rows, 5)).toEqual([rows]);
  });

  it('splits so no statement can pass the parameter ceiling', () => {
    const rows = Array.from({ length: 200_000 }, (_, index) => index);
    for (const columns of [1, 4, 5, 6, 8]) {
      const split = batches(rows, columns);
      expect(split.flat()).toEqual(rows);
      for (const batch of split) {
        expect(batch.length * columns).toBeLessThan(MAX_PARAMETERS);
      }
    }
  });
});
