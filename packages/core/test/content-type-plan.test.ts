import { describe, expect, it } from 'vitest';
import { fieldTypeReferences, mapFieldTypeReferences } from '../src/content-type-plan.js';

describe('type references in repeater sub-fields', () => {
  const repeater = {
    type: 'repeater',
    settings: {
      max: 3,
      fields: [
        { name: 'title', type: 'string' },
        { name: 'tile', type: 'block', settings: { type: 'tile' } },
        {
          name: 'inner',
          type: 'repeater',
          settings: { fields: [{ name: 'page', type: 'content', settings: { types: ['page'] } }] },
        },
      ],
    },
  };

  it('lists references at any depth, keyed by their settings path', () => {
    expect(fieldTypeReferences(repeater)).toEqual([
      { name: 'tile', target: 'block', key: 'fields.1.type' },
      { name: 'page', target: 'content', key: 'fields.2.fields.0.types' },
    ]);
  });

  it('maps references at any depth and leaves everything else alone', () => {
    const mapped = mapFieldTypeReferences(repeater, (name) => (name === 'tile' ? 'id-tile' : null));
    expect(mapped.settings.max).toBe(3);
    expect(mapped.settings.fields[0]).toEqual(repeater.settings.fields[0]);
    expect(mapped.settings.fields[1]?.settings).toEqual({ type: 'id-tile' });
    expect(fieldTypeReferences(mapped).map((reference) => reference.name)).toEqual(['id-tile']);
  });
});
