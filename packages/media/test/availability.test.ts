import { describe, expect, it } from 'vitest';
import { assetMaxAge, IMMUTABLE_MAX_AGE, isAvailable } from '../src/availability.js';

const NOW = new Date('2026-09-08T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('isAvailable', () => {
  it('serves an asset with no window at all', () => {
    expect(isAvailable({}, NOW)).toBe(true);
    expect(isAvailable({ publishAt: null, unpublishAt: null }, NOW)).toBe(true);
  });

  it('holds an asset back until its window opens', () => {
    expect(isAvailable({ publishAt: at(1) }, NOW)).toBe(false);
    expect(isAvailable({ publishAt: at(-1) }, NOW)).toBe(true);
  });

  it('stops serving one the moment its window closes', () => {
    expect(isAvailable({ unpublishAt: at(1) }, NOW)).toBe(true);
    // `unpublishAt` itself is already closed.
    expect(isAvailable({ unpublishAt: NOW }, NOW)).toBe(false);
  });
});

describe('assetMaxAge', () => {
  it('lets a cache keep an unscheduled asset for a year', () => {
    expect(assetMaxAge({}, NOW)).toBe(IMMUTABLE_MAX_AGE);
  });

  it('caps the lifetime at the next boundary, so a takedown is not cached past it', () => {
    expect(assetMaxAge({ unpublishAt: at(10) }, NOW)).toBe(600);
    // The nearer of the two decides.
    expect(assetMaxAge({ publishAt: at(5), unpublishAt: at(10) }, NOW)).toBe(300);
  });

  it('ignores a boundary that has already passed', () => {
    expect(assetMaxAge({ publishAt: at(-5) }, NOW)).toBe(IMMUTABLE_MAX_AGE);
  });
});
