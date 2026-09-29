import type { ContentTypeKind, FieldAdminSettings } from './types.js';

/**
 * Several content types at once, referencing each other by machine name. The input of
 * `contentTypes.applyPlan` and of AI designs. Browser-safe.
 */

export interface ContentTypePlanField {
  name: string;
  label?: string | undefined;
  /** A field type id: `string`, `richtext`, `blocks`, `asset`... */
  type: string;
  required?: boolean | undefined;
  localized?: boolean | undefined;
  unique?: boolean | undefined;
  /** The field type's settings; type references hold machine names. */
  settings?: Record<string, unknown> | undefined;
  admin?:
    | {
        zone?: FieldAdminSettings['zone'] | undefined;
        width?: number | undefined;
        help?: string | undefined;
        placeholder?: string | undefined;
      }
    | undefined;
}

export interface ContentTypePlanType {
  name: string;
  label?: string | undefined;
  description?: string | undefined;
  icon?: string | undefined;
  kind: ContentTypeKind;
  hasSlug?: boolean | undefined;
  isPublishable?: boolean | undefined;
  isVisibleInTree?: boolean | undefined;
  canBeVisibleInMenu?: boolean | undefined;
  requiresApproval?: boolean | undefined;
  fields: ContentTypePlanField[];
}

export interface ContentTypePlan {
  types: ContentTypePlanType[];
}

/** A setting that names other content types, and whether those must be blocks. */
export interface TypeReferenceSetting {
  key: string;
  many: boolean;
  /** `block` targets must be block types; `content` targets must be documents. */
  target: 'block' | 'content';
}

/** Settings per field type holding type references: names in a plan, ids elsewhere. */
const TYPE_REFERENCE_SETTINGS: Readonly<Record<string, readonly TypeReferenceSetting[]>> = {
  block: [{ key: 'type', many: false, target: 'block' }],
  blocks: [{ key: 'types', many: true, target: 'block' }],
  content: [{ key: 'types', many: true, target: 'content' }],
  link: [{ key: 'types', many: true, target: 'content' }],
  databag: [{ key: 'types', many: true, target: 'content' }],
};

/** Settings per field type holding inline sub-field definitions, walked for references. */
const SUB_FIELD_SETTINGS: Readonly<Record<string, string>> = { repeater: 'fields' };

type FieldLike = { type: string; settings?: Record<string, unknown> | undefined };

function subFieldsOf(field: FieldLike): { key: string; fields: FieldLike[] } | null {
  const key = SUB_FIELD_SETTINGS[field.type];
  const raw = key ? field.settings?.[key] : undefined;
  if (!key || !Array.isArray(raw)) return null;
  return {
    key,
    fields: raw.filter(
      (entry): entry is FieldLike =>
        typeof entry === 'object' && entry !== null && typeof entry.type === 'string',
    ),
  };
}

/** The type names one field refers to, whatever its field type, sub-fields included. */
export function fieldTypeReferences(
  field: FieldLike,
): Array<{ name: string; target: 'block' | 'content'; key: string }> {
  const out: Array<{ name: string; target: 'block' | 'content'; key: string }> = [];
  for (const setting of TYPE_REFERENCE_SETTINGS[field.type] ?? []) {
    const raw = field.settings?.[setting.key];
    const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    for (const value of values) {
      if (typeof value === 'string' && value) {
        out.push({ name: value, target: setting.target, key: setting.key });
      }
    }
  }
  const sub = subFieldsOf(field);
  for (const [index, subField] of (sub?.fields ?? []).entries()) {
    for (const reference of fieldTypeReferences(subField)) {
      out.push({ ...reference, key: `${sub?.key}.${index}.${reference.key}` });
    }
  }
  return out;
}

/** Rewrites a field's type references through `map`, dropping those it returns null for. */
export function mapFieldTypeReferences<
  T extends { type: string; settings?: Record<string, unknown> | undefined },
>(field: T, map: (value: string) => string | null): T {
  const settings = TYPE_REFERENCE_SETTINGS[field.type] ?? [];
  const sub = subFieldsOf(field);
  if ((!settings.length && !sub) || !field.settings) return field;

  const next: Record<string, unknown> = { ...field.settings };
  if (sub) {
    next[sub.key] = (next[sub.key] as unknown[]).map((entry) =>
      typeof entry === 'object' && entry !== null && typeof (entry as FieldLike).type === 'string'
        ? mapFieldTypeReferences(entry as FieldLike, map)
        : entry,
    );
  }
  for (const setting of settings) {
    const raw = next[setting.key];
    if (raw === undefined || raw === null) continue;
    if (setting.many) {
      const list = (Array.isArray(raw) ? raw : [raw])
        .map((value) => (typeof value === 'string' ? map(value) : null))
        .filter((value): value is string => Boolean(value));
      next[setting.key] = [...new Set(list)];
    } else {
      const mapped = typeof raw === 'string' ? map(raw) : null;
      if (mapped) next[setting.key] = mapped;
      else delete next[setting.key];
    }
  }
  return { ...field, settings: next };
}

/**
 * Creation order: block types before their embedders (document relations do not count).
 * Types in a block-reference cycle land in `cyclic`, to be created without those fields.
 */
export function planCreationOrder(plan: ContentTypePlan): {
  order: ContentTypePlanType[];
  cyclic: Set<string>;
} {
  const byName = new Map(plan.types.map((type) => [type.name, type]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: ContentTypePlanType[] = [];
  const cyclic = new Set<string>();

  const visit = (type: ContentTypePlanType, trail: string[]): void => {
    const current = state.get(type.name);
    if (current === 'done') return;
    if (current === 'visiting') {
      for (const name of trail.slice(trail.indexOf(type.name))) cyclic.add(name);
      return;
    }
    state.set(type.name, 'visiting');
    for (const field of type.fields) {
      for (const reference of fieldTypeReferences(field)) {
        if (reference.target !== 'block') continue;
        const dependency = byName.get(reference.name);
        if (dependency && dependency !== type) visit(dependency, [...trail, type.name]);
        else if (dependency === type) cyclic.add(type.name);
      }
    }
    state.set(type.name, 'done');
    order.push(type);
  };

  for (const type of plan.types) visit(type, []);
  return { order, cyclic };
}
