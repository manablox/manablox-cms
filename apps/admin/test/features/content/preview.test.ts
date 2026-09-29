import { describe, expect, it } from 'vitest';
import { withBlockTypeNames } from '~/features/content/model/preview';

const names: Record<string, string> = { 'id-teaser': 'teaser', 'id-columns': 'columns' };
const nameOf = (id: string) => names[id];

describe('withBlockTypeNames', () => {
  it('replaces a block type id with its name, recursively, and leaves everything else alone', () => {
    const fields = {
      summary: 'Hi',
      tags: ['a', 'b'],
      components: [
        {
          blockId: 'b1',
          type: 'id-columns',
          fields: { items: [{ blockId: 'b2', type: 'id-teaser', fields: { headline: 'x' } }] },
        },
      ],
    };

    const out = withBlockTypeNames(fields, nameOf) as typeof fields;

    expect(out.components[0]?.type).toBe('columns');
    expect(out.components[0]?.fields.items[0]?.type).toBe('teaser');
    expect(out.summary).toBe('Hi');
    expect(out.tags).toEqual(['a', 'b']);
    // The draft is not mutated: the admin keeps validating against ids.
    expect(fields.components[0]?.type).toBe('id-columns');
  });

  it('keeps an id it cannot resolve rather than dropping the block', () => {
    const out = withBlockTypeNames({ blockId: 'b', type: 'unknown', fields: {} }, nameOf);
    expect(out).toEqual({ blockId: 'b', type: 'unknown', fields: {} });
  });

  it('does not mistake a relation value or a plain object for a block', () => {
    const out = withBlockTypeNames({ hero: 'id-teaser', meta: { type: 'id-teaser' } }, nameOf);
    expect(out).toEqual({ hero: 'id-teaser', meta: { type: 'id-teaser' } });
  });
});
