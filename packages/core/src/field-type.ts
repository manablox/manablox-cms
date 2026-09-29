import { ManabloxError, ValidationCollector } from './errors.js';
import { validateStandard } from './standard-schema.js';
import type {
  AnyFieldType,
  BlockValue,
  ContentTypeDefinition,
  FieldDefinition,
  FieldItem,
  FieldReference,
  FieldStorage,
  FieldTypeDefinition,
  FieldValueContext,
  GraphQLFieldSpec,
} from './types.js';

/** Declares a field type - the whole extension surface, in one object. */
export function defineFieldType<TSettings, TValue>(
  definition: FieldTypeDefinition<TSettings, TValue>,
): FieldTypeDefinition<TSettings, TValue> {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.name)) {
    throw new ManabloxError('fieldType.name.invalid', {
      kind: 'bad_request',
      details: [{ key: 'fieldType.name.invalid', params: { name: definition.name } }],
    });
  }
  return definition;
}

/** Field types from config and plugins; core defines none itself. */
export class FieldTypeRegistry {
  private readonly types = new Map<string, AnyFieldType>();

  register(definition: AnyFieldType): void {
    const existing = this.types.get(definition.name);
    if (existing && existing !== definition) {
      throw ManabloxError.conflict('fieldType.name.duplicate', { name: definition.name });
    }
    this.types.set(definition.name, definition);
  }

  get(name: string): AnyFieldType {
    const type = this.types.get(name);
    if (!type) throw ManabloxError.notFound('fieldType.notFound', { name });
    return type;
  }

  tryGet(name: string): AnyFieldType | undefined {
    return this.types.get(name);
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  get names(): string[] {
    return [...this.types.keys()].sort();
  }

  get all(): AnyFieldType[] {
    return [...this.types.values()];
  }
}

// Helpers that resolve the polymorphic parts of a definition

export function resolveStorage(type: AnyFieldType, settings: unknown): FieldStorage {
  return typeof type.storage === 'function' ? type.storage(settings) : type.storage;
}

export function resolveGraphQL(type: AnyFieldType, settings: unknown): GraphQLFieldSpec {
  return typeof type.graphql === 'function' ? type.graphql(settings) : type.graphql;
}

export function fieldDefaultValue(type: AnyFieldType, settings: unknown): unknown {
  return type.defaultValue(settings);
}

export function fieldReferences(
  type: AnyFieldType,
  value: unknown,
  settings: unknown,
): FieldReference[] {
  if (!type.references) return [];
  return type.references(value, settings);
}

export function fieldBlocks(type: AnyFieldType, value: unknown, settings: unknown): BlockValue[] {
  if (!type.blocks) return [];
  return type.blocks(value, settings);
}

/** The inline definitions each item follows, or `null` when the type holds no items. */
export function fieldSubFields(type: AnyFieldType, settings: unknown): FieldDefinition[] | null {
  return type.subFields ? type.subFields(settings) : null;
}

export function fieldItems(type: AnyFieldType, value: unknown, settings: unknown): FieldItem[] {
  if (!type.items || value === null || value === undefined) return [];
  return type.items(value, settings);
}

/**
 * A block-like type holding a field's sub-fields, so field walkers recurse into its items.
 * Sub-field ids are qualified by the field, since they default to names.
 */
export function itemsContentType(
  parent: ContentTypeDefinition,
  field: Pick<FieldDefinition, 'id' | 'name' | 'label'>,
  fields: FieldDefinition[],
): ContentTypeDefinition {
  const id = `${parent.id}:${field.id}`;
  return {
    ...parent,
    id,
    name: `${parent.name}_${field.name}`,
    label: field.label,
    kind: 'block',
    hasSlug: false,
    isPublishable: false,
    isVisibleInTree: false,
    canBeVisibleInMenu: false,
    requiresApproval: false,
    fields: fields.map((sub) => ({ ...sub, id: `${id}:${sub.id}` })),
  };
}

/** Whether a value is unfilled: `null`, or empty by the type's own `isEmpty`. */
export function fieldIsEmpty(type: AnyFieldType, value: unknown, settings: unknown): boolean {
  if (value === null || value === undefined) return true;
  return type.isEmpty ? type.isEmpty(value, settings) : false;
}

/** Whether the type enforces `unique` with these settings. */
export function fieldSupportsUnique(type: AnyFieldType, settings: unknown): boolean {
  return typeof type.unique === 'function' ? type.unique(settings) : (type.unique ?? false);
}

export function fieldSearchText(
  type: AnyFieldType,
  value: unknown,
  settings: unknown,
): string | null {
  if (!type.search) return null;
  return type.search(value, settings);
}

/** Validates one field value against its type's schema; `required` also rejects empty values. */
export async function validateFieldValue(
  type: AnyFieldType,
  field: FieldDefinition,
  value: unknown,
  context: FieldValueContext,
): Promise<{ value: unknown; issues: ValidationCollector }> {
  const collector = new ValidationCollector();

  if (value === null || value === undefined) {
    if (field.required) collector.add('field.required', [field.name]);
    return { value: value ?? null, issues: collector };
  }

  const schema = type.valueSchema(field.settings, context);
  const result = await validateStandard(schema, value, `field.${type.name}`);

  if (!result.ok) {
    // An empty required value reads as missing, not malformed.
    if (field.required && fieldIsEmpty(type, value, field.settings)) {
      collector.add('field.required', [field.name]);
    } else {
      collector.merge(result.issues, [field.name]);
    }
    return { value, issues: collector };
  }

  if (field.required && fieldIsEmpty(type, result.value, field.settings)) {
    collector.add('field.required', [field.name]);
  }
  return { value: result.value, issues: collector };
}

/** Validates the settings a content-type author configured for a field. */
export async function validateFieldSettings(
  type: AnyFieldType,
  settings: unknown,
): Promise<{ settings: unknown; issues: ValidationCollector }> {
  const collector = new ValidationCollector();
  const result = await validateStandard(
    type.settingsSchema,
    settings,
    `fieldType.${type.name}.settings`,
  );

  if (!result.ok) {
    collector.merge(result.issues);
    return { settings, issues: collector };
  }

  return { settings: result.value, issues: collector };
}
