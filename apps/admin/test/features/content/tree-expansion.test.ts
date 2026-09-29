import { beforeEach, describe, expect, it } from 'vitest';
import { expansion } from '~/features/content/model/tree-expansion';

beforeEach(() => {
  localStorage.clear();
  // Reset to no space.
  expansion.scope(null, 'en');
});

describe('the content tree expansion', () => {
  it('remembers the open rows of a space and language, and reads them back', () => {
    expansion.scope('space-1', 'en');
    expansion.toggle('a');
    expansion.expand(['b', 'c']);
    expect([...expansion.open.value]).toEqual(['a', 'b', 'c']);

    // A separate tree without the first one's rows.
    expansion.scope('space-1', 'de');
    expect(expansion.open.value.size).toBe(0);
    expansion.toggle('d');

    expansion.scope('space-1', 'en');
    expect([...expansion.open.value]).toEqual(['a', 'b', 'c']);
    expect(expansion.isOpen('d')).toBe(false);
  });

  it('survives a reload: the stored ids are what a fresh scope opens', () => {
    expansion.scope('space-2', 'en');
    expansion.expand(['root', 'child']);
    expansion.toggle('root');

    // The next session reads the stored value, not the ref.
    expect(JSON.parse(localStorage.getItem('manablox.tree.open.space-2.en') as string)).toEqual([
      'child',
    ]);
    expansion.scope(null, 'en');
    expansion.scope('space-2', 'en');
    expect([...expansion.open.value]).toEqual(['child']);
  });

  it('leaves an unknown space with nothing open', () => {
    expansion.scope(null, 'en');
    expect(expansion.open.value.size).toBe(0);
  });
});
