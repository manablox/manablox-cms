import { describe, expect, it } from 'vitest';
import { selectField, settingsSchemaOf } from '../src/index.js';

describe('settingsSchemaOf', () => {
  it("writes a field type's settings as compact JSON Schema", () => {
    const schema = JSON.parse(settingsSchemaOf(selectField) ?? 'null');
    expect(schema).toMatchObject({ type: 'object' });
    expect(Object.keys(schema.properties ?? {})).toContain('options');
    // Only the keys a model needs; `$schema` and friends are dropped.
    expect(schema).not.toHaveProperty('$schema');
  });

  it('answers null for a settings schema without JSON Schema', () => {
    expect(settingsSchemaOf({ ...selectField, settingsSchema: {} as never })).toBeNull();
  });
});
