import { describe, expect, it } from 'vitest';
import { completeSubFields, itemsOf, toRawSubField } from '~/lib/sub-fields';

describe('repeater sub-fields', () => {
  it('completes raw definitions like the server', () => {
    const [title, image] = completeSubFields({
      fields: [
        { name: 'title', type: 'string', required: true },
        {
          id: 'i1',
          name: 'image',
          label: 'Image',
          type: 'asset',
          admin: { width: 50, help: 'Wide' },
        },
        { name: 42, type: 'string' },
      ],
    });
    expect(title).toEqual({
      id: 'title',
      name: 'title',
      label: 'title',
      type: 'string',
      settings: {},
      required: true,
      localized: false,
      unique: false,
      admin: { zone: 'main', width: 100, position: 0 },
    });
    expect(image?.id).toBe('i1');
    expect(image?.admin).toEqual({ zone: 'main', width: 50, position: 1, help: 'Wide' });
    expect(completeSubFields(undefined)).toEqual([]);
  });

  it('keeps the stored order, so indexes match server error paths', () => {
    const fields = completeSubFields({
      fields: [
        { name: 'b', type: 'string', admin: { position: 1 } },
        { name: 'a', type: 'string', admin: { position: 0 } },
      ],
    });
    expect(fields.map((field) => field.name)).toEqual(['b', 'a']);
  });

  it('stores only what a sub-field takes', () => {
    const [field] = completeSubFields({ fields: [{ name: 'title', type: 'string' }] });
    expect(
      toRawSubField({ ...field!, localized: true, admin: { ...field!.admin, zone: 'sidebar' } }),
    ).toEqual({
      id: 'title',
      name: 'title',
      label: 'title',
      type: 'string',
      settings: {},
      required: false,
      admin: { width: 100, position: 0 },
    });
  });

  it('drops malformed items', () => {
    expect(itemsOf([{ itemId: 'a', fields: {} }, { fields: {} }, null])).toEqual([
      { itemId: 'a', fields: {} },
    ]);
    expect(itemsOf(null)).toEqual([]);
  });
});
