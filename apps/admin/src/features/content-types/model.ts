import type {
  ContentTypeSummary,
  FieldDefinition,
  FieldTypeMeta,
} from '@manablox/admin-sdk/features/content-types/queries';
import type { ApiErrorDetail } from '@manablox/admin-sdk/lib/api-errors';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { moveInList } from '@manablox/admin-sdk/lib/collections';
import { messageForKey } from '@manablox/admin-sdk/lib/messages';
import { technicalName } from '@manablox/core';
import { completeSubFields, toRawSubField } from '~/lib/sub-fields';

export type TypeKind = 'content' | 'block' | 'data';

/** The content type editor's form. */
export interface ContentTypeDraft {
  id?: string;
  name: string;
  label: string;
  icon?: string | undefined;
  kind: TypeKind;
  hasSlug: boolean;
  isPublishable: boolean;
  isVisibleInTree: boolean;
  canBeVisibleInMenu: boolean;
  requiresApproval: boolean;
  fields: FieldDefinition[];
}

/** Eyebrow of a saved type. */
export const KIND_LABELS: Record<TypeKind, string> = {
  content: 'Content type',
  block: 'Block type',
  data: 'Databag type',
};

/** Icon shown until one is picked. */
export const KIND_ICONS: Record<TypeKind, string> = {
  content: 'doc',
  block: 'blocks',
  data: 'database',
};

/** Why a type cannot be deleted while it is in use. */
export const DELETE_WARNINGS: Record<TypeKind, string> = {
  block:
    'Blocks of this type already placed in documents show as unknown, and those documents cannot be saved until the blocks are removed.',
  data: 'A databag type can only be deleted once it has no entries left, in any language. Delete its entries first.',
  content:
    'A content type can only be deleted once no documents of it are left, in any language. Delete its documents first.',
};

/** A new type of `kind`; only content types are routed. */
export function blankType(kind: TypeKind): ContentTypeDraft {
  const routed = kind === 'content';
  return {
    name: '',
    label: '',
    kind,
    hasSlug: routed,
    isPublishable: true,
    isVisibleInTree: routed,
    canBeVisibleInMenu: routed,
    requiresApproval: false,
    fields: [],
  };
}

export function typeToDraft(type: ContentTypeSummary): ContentTypeDraft {
  return {
    id: type.id,
    name: type.name,
    label: type.label,
    icon: type.icon ?? undefined,
    kind: type.kind,
    hasSlug: type.hasSlug,
    isPublishable: type.isPublishable,
    isVisibleInTree: type.isVisibleInTree,
    canBeVisibleInMenu: type.canBeVisibleInMenu,
    requiresApproval: type.requiresApproval,
    fields: plainClone(type.fields) as FieldDefinition[],
  };
}

/** A new field at `position`; its empty name follows the label. */
export function newField(
  typeName: string,
  meta: FieldTypeMeta | null,
  position: number,
): FieldDefinition {
  return {
    id: crypto.randomUUID(),
    name: '',
    label: meta?.label ?? typeName,
    type: typeName,
    settings: {},
    required: false,
    localized: false,
    unique: false,
    admin: { zone: 'main', width: 100, position },
  };
}

/** Moves a field and renumbers positions; the same array when nothing moved. */
export function moveField(fields: FieldDefinition[], from: number, to: number): FieldDefinition[] {
  const next = moveInList(fields, from, to);
  if (next === fields) return fields;
  return next.map((field, index) => ({ ...field, admin: { ...field.admin, position: index } }));
}

/** Names untouched fields from their default label, numbered on collision; repeaters recurse. */
export function nameUnnamedFields(fields: FieldDefinition[]): FieldDefinition[] {
  const taken = new Set(fields.map((field) => field.name).filter(Boolean));
  return fields.map((field) => {
    const named = field.name ? field : { ...field, name: freeName(field, taken) };
    taken.add(named.name);
    if (!Array.isArray(field.settings.fields) || field.type !== 'repeater') return named;
    const subFields = nameUnnamedFields(completeSubFields(field.settings)).map(toRawSubField);
    return { ...named, settings: { ...named.settings, fields: subFields } };
  });
}

function freeName(field: FieldDefinition, taken: ReadonlySet<string>): string {
  const base = technicalName(field.label || field.type, { final: true }) || 'field';
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** The flags a kind takes: none for blocks, publishing for databags. */
export function typeFlags(draft: ContentTypeDraft) {
  if (draft.kind === 'block') return {};
  const publishing = {
    isPublishable: draft.isPublishable,
    requiresApproval: draft.isPublishable && draft.requiresApproval,
  };
  if (draft.kind === 'data') return publishing;
  return {
    hasSlug: draft.hasSlug,
    isVisibleInTree: draft.isVisibleInTree,
    canBeVisibleInMenu: draft.canBeVisibleInMenu,
    ...publishing,
  };
}

/** Field positions named by error paths. */
export function erroredFields(errors: readonly ApiErrorDetail[]): Set<number> {
  const indexes = new Set<number>();
  for (const detail of errors) {
    const [root, index] = detail.path ?? [];
    if (root === 'fields' && typeof index === 'number') indexes.add(index);
  }
  return indexes;
}

/** Whether an error sits at a path or inside it. */
export type ErrorUnder = (path: readonly (string | number)[]) => boolean;

export function errorUnderOf(errors: readonly ApiErrorDetail[]): ErrorUnder {
  return (path) =>
    path.length > 0 &&
    errors.some((detail) => path.every((segment, index) => detail.path?.[index] === segment));
}

export function scopedUnder(
  errorUnder: ErrorUnder,
  prefix: readonly (string | number)[],
): ErrorUnder {
  return (path) => errorUnder([...prefix, ...path]);
}

/** Error paths the editor shows beside an input: names, also of repeater sub-fields. */
export function isInlineTypeError(path: readonly (string | number)[]): boolean {
  if (path.length === 0) return true;
  if (path.length === 1) return path[0] === 'name';
  let at = 0;
  while (path[at] === 'fields' && typeof path[at + 1] === 'number') {
    if (path[at + 2] === 'name' && path.length === at + 3) return true;
    if (path[at + 2] !== 'settings') return false;
    at += 3;
  }
  return false;
}

/** An error without an input, led by the field's label instead of `fields.0.options`. */
export function describeTypeError(draft: ContentTypeDraft | null, detail: ApiErrorDetail): string {
  const path = detail.path ?? [];
  const labels: string[] = [];
  let fields: FieldDefinition[] | undefined = draft?.fields;
  let at = 0;
  while (fields && path[at] === 'fields' && typeof path[at + 1] === 'number') {
    const field: FieldDefinition | undefined = fields[path[at + 1] as number];
    if (!field) break;
    labels.push(field.label || field.name);
    fields = path[at + 2] === 'settings' ? completeSubFields(field.settings) : undefined;
    at += 3;
  }
  let where = '';
  if (labels.length) where = `${labels.join(' > ')}: `;
  else if (path.length) where = `${path.join('.')}: `;
  return `${where}${messageForKey(detail.key, detail.params)}`;
}
