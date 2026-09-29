import { getAt, setAt } from '@manablox/admin-sdk/lib/paths';
import { describe, expect, it } from 'vitest';

const doc = () => ({
  links: [
    { itemId: 'a', fields: { label: 'One', nested: [{ itemId: 'b', fields: { url: '/x' } }] } },
  ],
  body: { blocks: [{ blockId: 'k', type: 't', fields: { rows: [{ itemId: 'c', fields: {} }] } }] },
});

describe('field paths', () => {
  it('reads sub-fields of repeater items without a fields segment', () => {
    expect(getAt(doc(), ['links', 0, 'label'])).toBe('One');
    expect(getAt(doc(), ['links', 0, 'nested', 0, 'url'])).toBe('/x');
    expect(getAt(doc(), ['links', 0, 'itemId'])).toBe('a');
  });

  it('writes sub-fields of repeater items into their fields', () => {
    const next = setAt(doc(), ['links', 0, 'label'], 'Two');
    expect(next.links[0]).toEqual({
      ...doc().links[0],
      fields: { ...doc().links[0]!.fields, label: 'Two' },
    });
    const deep = setAt(doc(), ['body', 0, 'rows', 0, 'title'], 'Hi');
    expect(getAt(deep, ['body', 0, 'rows', 0, 'title'])).toBe('Hi');
    expect(deep.body.blocks[0]!.fields.rows[0]).toEqual({ itemId: 'c', fields: { title: 'Hi' } });
  });

  it('leaves the original untouched', () => {
    const original = doc();
    setAt(original, ['links', 0, 'label'], 'Two');
    expect(original.links[0]!.fields.label).toBe('One');
  });

  it('keeps plugin data on the block, not among its fields', () => {
    const root = {
      body: { blocks: [{ blockId: 'b1', type: 't', fields: { ext: 'a field' } }] },
    };
    const design = { style: { textAlign: 'center' } };
    const styled = setAt(root, ['body', 0, 'ext', 'website'], design);
    expect(styled.body.blocks[0]).toEqual({
      blockId: 'b1',
      type: 't',
      fields: { ext: 'a field' },
      ext: { website: design },
    });
    expect(getAt(styled, ['body', 0, 'ext', 'website'])).toEqual(design);
    const cleared = setAt(styled, ['body', 0, 'ext', 'website'], undefined);
    expect(cleared.body.blocks[0]).toEqual({
      blockId: 'b1',
      type: 't',
      fields: { ext: 'a field' },
      ext: {},
    });
  });
});
