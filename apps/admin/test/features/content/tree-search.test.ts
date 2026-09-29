import { highlightParts, searchRows } from '@manablox/admin-sdk/features/content/model/tree-search';
import { describe, expect, it } from 'vitest';

const node = (id: string, parentId: string | null, position: number, match = false) =>
  ({ content: { id, title: id, position }, parentId, match }) as never;

describe('tree search rows', () => {
  it('orders nodes as the tree does, each after its parent', () => {
    const rows = searchRows([
      node('hit-b', 'folder', 1, true),
      node('folder', null, 0),
      node('hit-a', 'folder', 0, true),
      node('root-hit', null, 1, true),
    ]);
    expect(rows.map((row) => [row.content.id, row.depth, row.match])).toEqual([
      ['folder', 0, false],
      ['hit-a', 1, true],
      ['hit-b', 1, true],
      ['root-hit', 0, true],
    ]);
  });

  it('splits a title around every case-insensitive hit', () => {
    expect(highlightParts('News and news', 'NEWS')).toEqual([
      { text: 'News', hit: true },
      { text: ' and ', hit: false },
      { text: 'news', hit: true },
    ]);
    expect(highlightParts('About', '  ')).toEqual([{ text: 'About', hit: false }]);
  });
});
