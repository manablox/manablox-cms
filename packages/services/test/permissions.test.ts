import type { ContentTypeDefinition } from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { describe, expect, it } from 'vitest';
import { applyReadPermissions, readRestrictedFields } from '../src/content/permissions.js';

const type = (fields: ContentTypeDefinition['fields']) =>
  ({ id: 'type', name: 'page', fields }) as ContentTypeDefinition;

const row = {
  id: 'row',
  typeId: 'type',
  fields: { title: 'Hi', secret: 'x' },
} as never as ContentRow;

describe('readRestrictedFields', () => {
  it('lists role-gated fields once per fields list', () => {
    const gated = type([
      { id: 'a', name: 'title', type: 'string' },
      { id: 'b', name: 'secret', type: 'string', readRoles: ['admin'] },
    ] as ContentTypeDefinition['fields']);
    const first = readRestrictedFields(gated);
    expect(first.map((field) => field.name)).toEqual(['secret']);
    expect(readRestrictedFields(gated)).toBe(first);
    // A reloaded type brings a new fields list.
    const reloaded = type(gated.fields.slice(0, 1));
    expect(readRestrictedFields(reloaded)).toEqual([]);
  });
});

describe('applyReadPermissions', () => {
  it('returns the row itself for a type without role-gated fields', () => {
    const open = type([
      { id: 'a', name: 'title', type: 'string' },
    ] as ContentTypeDefinition['fields']);
    expect(applyReadPermissions(row, open, null)).toBe(row);
  });

  it('strips role-gated fields for a reader without the role', () => {
    const gated = type([
      { id: 'a', name: 'title', type: 'string' },
      { id: 'b', name: 'secret', type: 'string', readRoles: ['admin'] },
    ] as ContentTypeDefinition['fields']);
    expect(applyReadPermissions(row, gated, null).fields).toEqual({ title: 'Hi' });
    expect(row.fields).toHaveProperty('secret');
  });
});
