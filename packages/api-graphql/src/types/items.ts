import {
  type ContentTypeDefinition,
  type FieldItem,
  fieldSubFields,
  graphqlTypeName,
  itemsContentType,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Builder, ObjectRefOf } from '../builder.js';
import type { FieldMapper } from '../fields.js';

/** An items field's object type, keyed by its synthetic content type id. */
export interface ItemType {
  type: ContentTypeDefinition;
  ref: ObjectRefOf<FieldItem>;
}

/**
 * One `<Type><Field>Item` object type per items field, nested ones included. A name
 * already taken gets a numeric suffix so the schema still builds.
 */
export function defineItemRefs(
  builder: Builder,
  manablox: Manablox,
  types: ContentTypeDefinition[],
): Map<string, ItemType> {
  const out = new Map<string, ItemType>();
  const taken = new Set(types.map((type) => graphqlTypeName(type.name)));

  const visit = (parent: ContentTypeDefinition) => {
    for (const field of parent.fields) {
      const fieldType = manablox.fieldTypes.tryGet(field.type);
      if (!fieldType || field.readRoles?.length) continue;
      const subFields = fieldSubFields(fieldType, field.settings);
      if (!subFields) continue;

      const type = itemsContentType(parent, field, subFields);
      const base = `${graphqlTypeName(type.name)}Item`;
      let name = base;
      for (let n = 2; taken.has(name); n += 1) name = `${base}${n}`;
      if (name !== base) {
        manablox.logger.warn({ graphqlName: base, used: name }, 'item type name already taken');
      }
      taken.add(name);

      out.set(type.id, { type, ref: builder.objectRef<FieldItem>(name) });
      visit(type);
    }
  };
  for (const type of types) visit(type);
  return out;
}

/** `itemId` plus the sub-fields, resolved like top-level fields. */
export function defineItemTypes(
  builder: Builder,
  itemTypes: Map<string, ItemType>,
  buildFieldMap: FieldMapper,
): void {
  for (const { type, ref } of itemTypes.values()) {
    builder.objectType(ref, {
      fields: (t) => ({
        itemId: t.exposeID('itemId', { nullable: false }),
        ...buildFieldMap(t, type, (item: FieldItem) => item.fields),
      }),
    });
  }
}
