import { mockAdminApi } from '@manablox/admin-sdk/testing';
import type { FieldDefinition } from '@manablox/core';
import { validateSiteDesign } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { fixedFormDesign } from '../../src/admin/model/form-preset';
import { FORM_PRESET } from '../../src/admin/slots/form-preset-entry';

mockAdminApi();

/** The preset's fields as the admin stores them on the new type. */
const presetFields = (): FieldDefinition[] =>
  FORM_PRESET.preset.fields.map(({ zone: _zone, ...field }, position) => ({
    id: `f${position}`,
    ...field,
  })) as FieldDefinition[];

describe('the fixed-form block preset', () => {
  it('is a block preset', () => {
    expect(FORM_PRESET.preset).toMatchObject({ id: 'databag-form', kind: 'block' });
  });

  it('asks for the databag type before the type is saved', () => {
    expect(FORM_PRESET.validate?.({})).toBe('Pick the databag type the form stores in.');
    expect(FORM_PRESET.validate?.({ databag: 'bag' })).toBeNull();
  });

  it('designs a fixed-form block with an input per field of its databag', () => {
    const fields = presetFields();
    const design = fixedFormDesign(
      { fields },
      {
        id: 'bag',
        label: 'Contact',
        fields: [
          { id: 'n', name: 'name', type: 'string', required: true },
          { id: 'm', name: 'message', type: 'string', settings: { editor: 'textarea' } },
        ],
      },
      'en',
    );
    const root = design.variants.default!.root;
    const form = root.children?.at(-1);
    expect(form?.el).toBe('form');
    expect(form?.props?.databagTypeId).toBe('bag');
    expect(form?.children?.filter((node) => node.el === 'formField')).toHaveLength(2);
    expect(root.children?.slice(0, -1).map((node) => node.bind?.field)).toEqual(
      fields.map((field) => field.id),
    );
    expect(validateSiteDesign('block', design)).toMatchObject({ ok: true });
  });
});
