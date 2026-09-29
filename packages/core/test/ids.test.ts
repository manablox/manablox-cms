import { describe, expect, it } from 'vitest';
import { slugDraft, technicalName } from '../src/ids.js';

describe('technicalName', () => {
  it('lower-cases, transliterates umlauts and replaces separators', () => {
    expect(technicalName('My Blog')).toBe('my-blog');
    expect(technicalName('Grüße')).toBe('gruesse');
    expect(technicalName('Café au lait')).toBe('cafe-au-lait');
  });

  it('keeps a trailing separator while typing and drops it once final', () => {
    expect(technicalName('my ')).toBe('my-');
    expect(technicalName('my ', { final: true })).toBe('my');
  });

  it('strips a leading digit only when final', () => {
    expect(technicalName('2024 review')).toBe('2024-review');
    expect(technicalName('2024 review', { final: true })).toBe('review');
  });

  it('caps at 64 characters', () => {
    expect(technicalName('a'.repeat(80))).toHaveLength(64);
  });
});

describe('slugDraft', () => {
  it('allows a leading digit and collapses runs', () => {
    expect(slugDraft('2024 - Review!!')).toBe('2024-review-');
    expect(slugDraft('2024 - Review!!', { final: true })).toBe('2024-review');
  });
});
