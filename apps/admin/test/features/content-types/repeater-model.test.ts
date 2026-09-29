import { describe, expect, it } from 'vitest';
import {
  blankType,
  describeTypeError,
  errorUnderOf,
  isInlineTypeError,
  nameUnnamedFields,
  newField,
} from '~/features/content-types/model';

const repeater = () => ({
  ...newField('repeater', null, 0),
  name: 'links',
  label: 'Links',
  settings: {
    fields: [
      { id: 's1', name: '', label: 'Link text', type: 'string' },
      { id: 's2', name: 'link-text', label: 'Other', type: 'string' },
    ],
  },
});

describe('repeater sub-fields in the type builder', () => {
  it('names unnamed sub-fields from their labels', () => {
    const [field] = nameUnnamedFields([repeater()]);
    const names = (field!.settings.fields as { name: string }[]).map((entry) => entry.name);
    expect(names).toEqual(['link-text-2', 'link-text']);
  });

  it('shows sub-field name errors inline, other sub-field errors not', () => {
    expect(isInlineTypeError(['fields', 0, 'name'])).toBe(true);
    expect(isInlineTypeError(['fields', 0, 'settings', 'fields', 1, 'name'])).toBe(true);
    expect(isInlineTypeError(['fields', 0, 'settings', 'fields', 1, 'type'])).toBe(false);
    expect(isInlineTypeError(['fields', 0, 'settings'])).toBe(false);
  });

  it('leads a sub-field error with both labels', () => {
    const draft = { ...blankType('content'), fields: [repeater()] };
    const text = describeTypeError(draft, {
      key: 'contentType.field.subFields.tooDeep',
      path: ['fields', 0, 'settings', 'fields', 1, 'settings'],
    } as never);
    expect(text.startsWith('Links > Other: ')).toBe(true);
  });

  it('finds errors under a prefix', () => {
    const under = errorUnderOf([
      { key: 'x', path: ['fields', 0, 'settings', 'fields', 1, 'name'] },
    ] as never);
    expect(under(['fields', 0, 'settings', 'fields', 1])).toBe(true);
    expect(under(['fields', 0, 'settings', 'fields', 0])).toBe(false);
    expect(under([])).toBe(false);
  });
});
