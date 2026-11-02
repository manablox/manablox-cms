import {
  type AnyFieldType,
  type ContentTypeDefinition,
  type ContentTypePlan,
  type ContentTypePlanField,
  type ContentTypePlanType,
  fieldTypeReferences,
  humanise,
  isDocumentType,
  isMachineName,
  mapFieldTypeReferences,
  validateFieldSettings,
} from '@manablox/core';
import { stableId } from '@manablox/core/node';
import { settingsSchemaOf } from '@manablox/fields';

/**
 * Content model design: the prompt, and reading the answer into an applicable
 * `ContentTypePlan`. Cosmetic issues are fixed; breaking ones are reported and left out.
 */

/** Which types a design may produce. */
export type ContentTypeDesignScope = 'any' | 'content' | 'block';

export interface ContentTypeDesignContext {
  fieldTypes: readonly AnyFieldType[];
  /** Types a design may reference but not redesign. */
  existing: readonly ContentTypeDefinition[];
  scope: ContentTypeDesignScope;
  /** Allowed icon names. */
  icons?: readonly string[] | undefined;
}

export interface ContentTypeDesign {
  plan: ContentTypePlan;
  /** Existing types the plan refers to, by name. */
  reused: string[];
  /** The model's notes for the editor. */
  notes: string;
}

/** Field widths the editor grid offers. */
const WIDTHS = [25, 33, 50, 66, 75, 100] as const;

/** Document column names a field must not shadow. */
const RESERVED_FIELDS = new Set(['slug']);

/** How many repeaters deep sub-fields may nest, the outermost included. */
const MAX_SUB_FIELD_DEPTH = 2;

export const CONTENT_TYPE_DESIGN_SYSTEM = [
  'You design content models for Manablox, a headless CMS.',
  'You answer with one JSON object and nothing else: no markdown fence, no commentary.',
  'You design exactly what the request needs, named plainly, and reuse what already exists.',
].join(' ');

/** The instruction for a content model design. */
export function composeContentTypeDesignPrompt(
  request: string,
  context: ContentTypeDesignContext,
): string {
  const scope =
    context.scope === 'block'
      ? 'Design block types only - sections an editor places inside a document. Do not design any document type.'
      : context.scope === 'content'
        ? 'Design the document type the request describes, plus any block types it needs that do not exist yet.'
        : 'Design every document type and block type the request needs.';

  return [
    'Manablox organises a website as documents - pages, articles, products, people - each of a content type. A document type may hold blocks: reusable sections, each of a block type, arranged by the editor in a block field.',
    scope,
    [
      'Rules:',
      '- A content type has "kind": "content" (a document an editor creates, publishes and links to), "data" (a databag: flat records such as authors, categories or opening hours, kept outside the page tree with no URL and no menu entry, referenced from documents) or "block" (a section that only ever lives inside a document\'s block field).',
      '- "name" is a machine name: lowercase letters and digits, words joined by "_" or "-", starting with a letter, at most 64 characters - "landing_page", "hero", "product_card". "label" is what an editor reads: "Landing page".',
      '- Every document already has a title and a slug; never add a field for either.',
      '- Document flags, all optional: "hasSlug" (has its own URL, default true), "isPublishable" (default true), "isVisibleInTree" (listed in the content tree, default true), "canBeVisibleInMenu" (default true), "requiresApproval" (default false). Leave them out unless the request implies otherwise - a "settings" or "author" type that is never a page gets "hasSlug": false and "canBeVisibleInMenu": false. A "data" type takes only "isPublishable" and "requiresApproval"; a block takes none of them.',
      '- A field is {"name", "label", "type", "required", "localized", "settings", "admin": {"zone", "width", "help"}}. "localized" is true for text the space translates and false for numbers, dates, switches, relations and media. "zone" is "main" for the content and "sidebar" for metadata such as dates, switches, categories and relations. "width" is a share of the row - 25, 33, 50, 66, 75 or 100 - and fields whose widths add up to 100 sit side by side. "help" is one short sentence for the editor, only where the label is not enough.',
      '- "settings" follow the field type\'s schema below; leave out any setting whose default is right.',
      '- A block field names block types by their machine name: "blocks" takes {"types": ["hero", "text_section"]} and "block" takes {"type": "hero"}. A relation ("content", "link") names document types, "content" or "data", in "types". A "databag" field lets the editor pick a "data" type that a site form stores what visitors send in; its optional "types" names the allowed ones. A name is one you design here or one that already exists below.',
      context.fieldTypes.some((type) => type.name === 'repeater')
        ? '- A "repeater" field holds a list of items that share a small set of fields - quotes, team members, features, opening hours - when the items only ever live in that one type. Its "settings" are {"fields": [<sub-fields>], "min", "max"}; a sub-field is {"name", "label", "type", "required", "settings", "admin": {"width", "help"}}, without "localized" or "zone", and sub-field names are machine names unique within the repeater. A repeater may hold one more repeater, no deeper. Use a block type instead for a section the editor arranges on the page.'
        : '',
      '- Give a document that is composed of sections - a page, a landing page, a long article - a "blocks" field, and design the block types those sections need: a hero, text, text with image, gallery, quote, call to action, FAQ, cards - whatever the request implies, each with the fields that section needs and no more.',
      '- Reuse an existing type rather than designing a second one for the same job, and never design a type whose name already exists.',
      context.icons?.length
        ? `- "icon" is one of: ${context.icons.join(', ')}. Pick the one that reads as the type.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    ['Field types:', ...context.fieldTypes.map(describeFieldType)].join('\n'),
    context.existing.length
      ? [
          'Types that already exist:',
          ...context.existing.map((type) => describeExisting(type, context.existing)),
        ].join('\n')
      : 'No types exist yet.',
    'Answer with a single JSON object: {"types": [{"name", "label", "kind", "description", "icon", <flags>, "fields": [...]}, ...], "notes": "<one or two sentences to the editor about the design>"}. List block types before the documents that use them.',
    `The request: ${request.trim()}`,
  ].join('\n\n');
}

/** Reads an answer into a plan, fixing what it can and listing the rest as problems. */
export async function readContentTypeDesign(
  answer: Record<string, unknown>,
  context: ContentTypeDesignContext,
): Promise<{ value: ContentTypeDesign; problems: string[] }> {
  const problems: string[] = [];
  const existingByName = new Map(context.existing.map((type) => [type.name, type]));
  const rawTypes = Array.isArray(answer.types) ? answer.types : [];
  if (!rawTypes.length) problems.push('"types" must be a non-empty list of content types.');

  // First pass: types, so field references can be resolved in the second.
  const kept = readTypes(rawTypes, context, existingByName, problems);
  if (context.scope === 'content' && !kept.some((entry) => isDocumentType(entry.type))) {
    problems.push('The design has no document type; the request asked for one.');
  }

  const reader: FieldReader = {
    problems,
    fieldTypes: new Map(context.fieldTypes.map((type) => [type.name, type])),
    plannedKinds: new Map(kept.map((entry) => [entry.type.name, entry.type.kind])),
    existingByName,
    ...referenceIds(kept, context.existing),
    reused: new Set<string>(),
  };
  for (const { type, rawFields } of kept) {
    const names = new Set<string>();
    for (const [index, raw] of rawFields.entries()) {
      const field = await readField(reader, type.name, raw, index, names);
      if (!field) continue;
      names.add(field.name);
      type.fields.push(field);
    }
    if (!type.fields.length && isDocumentType(type) && rawFields.length) {
      problems.push(`The type "${type.name}" was left with no usable fields.`);
    }
  }

  return {
    value: {
      plan: { types: kept.map((entry) => entry.type) },
      reused: [...reader.reused],
      notes: text(answer.notes, 1000),
    },
    problems,
  };
}

/** A designed type, its fields still unread. */
interface KeptType {
  type: ContentTypePlanType;
  rawFields: unknown[];
}

/** The answer's types without their fields; invalid, existing and repeated ones are reported. */
function readTypes(
  rawTypes: unknown[],
  context: ContentTypeDesignContext,
  existingByName: ReadonlyMap<string, ContentTypeDefinition>,
  problems: string[],
): KeptType[] {
  const kept: KeptType[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawTypes.entries()) {
    if (!raw || typeof raw !== 'object') {
      problems.push(`types[${index}] is not an object.`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!isMachineName(name)) {
      problems.push(`types[${index}] has the name "${name}", which is not a valid machine name.`);
      continue;
    }
    if (existingByName.has(name)) {
      problems.push(
        `The type "${name}" already exists. Refer to it by name instead of designing it again, or give the new type another name.`,
      );
      continue;
    }
    if (seen.has(name)) {
      problems.push(`The type "${name}" is designed twice; design it once.`);
      continue;
    }
    const kind =
      entry.kind === 'block' || entry.kind === 'content' || entry.kind === 'data'
        ? entry.kind
        : null;
    if (!kind) {
      problems.push(`The type "${name}" needs "kind": "content", "data" or "block".`);
      continue;
    }
    if (context.scope === 'block' && kind !== 'block') {
      problems.push(`The type "${name}" is a document type, but only block types were asked for.`);
      continue;
    }
    seen.add(name);
    kept.push({
      type: {
        name,
        label: text(entry.label, 100) || humanise(name),
        kind,
        ...(text(entry.description, 500) ? { description: text(entry.description, 500) } : {}),
        ...(pickIcon(entry.icon, context.icons)
          ? { icon: pickIcon(entry.icon, context.icons) }
          : {}),
        ...(kind === 'block' ? {} : flags(entry, kind === 'data')),
        fields: [],
      },
      rawFields: Array.isArray(entry.fields) ? entry.fields : [],
    });
  }
  return kept;
}

/** Planned types get placeholder ids for settings validation; mapped back to names after. */
function referenceIds(kept: readonly KeptType[], existing: readonly ContentTypeDefinition[]) {
  const idOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const { type } of kept) {
    const id = stableId('contentType', `plan:${type.name}`);
    idOf.set(type.name, id);
    nameOf.set(id, type.name);
  }
  for (const type of existing) {
    idOf.set(type.name, type.id);
    nameOf.set(type.id, type.name);
  }
  return { idOf, nameOf };
}

/** What reading fields needs: the known types and field types, and where problems go. */
interface FieldReader {
  problems: string[];
  fieldTypes: ReadonlyMap<string, AnyFieldType>;
  /** Kinds of the types designed here, by name. */
  plannedKinds: ReadonlyMap<string, ContentTypePlanType['kind']>;
  existingByName: ReadonlyMap<string, ContentTypeDefinition>;
  idOf: ReadonlyMap<string, string>;
  nameOf: ReadonlyMap<string, string>;
  /** Existing types a field refers to. */
  reused: Set<string>;
}

/** Reference targets are `block` or `content`; databags count as documents. */
function targetOf(reader: FieldReader, name: string): 'block' | 'content' | undefined {
  const kind = reader.plannedKinds.get(name) ?? reader.existingByName.get(name)?.kind;
  return kind ? (isDocumentType({ kind }) ? 'content' : 'block') : undefined;
}

/** One field of a designed type; `null` when skipped or reported. */
async function readField(
  reader: FieldReader,
  typeName: string,
  raw: unknown,
  index: number,
  names: ReadonlySet<string>,
): Promise<ContentTypePlanField | null> {
  const { problems, fieldTypes } = reader;
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const where = `field "${name || index}" of "${typeName}"`;

  if (!isMachineName(name)) {
    problems.push(`The ${where} does not have a valid machine name.`);
    return null;
  }
  // A `title` field is allowed; `slug` is not.
  if (RESERVED_FIELDS.has(name) || names.has(name)) return null;
  const fieldType = fieldTypes.get(String(entry.type ?? ''));
  if (!fieldType) {
    problems.push(
      `The ${where} has the type "${String(entry.type)}", which does not exist. Use one of: ${[...fieldTypes.keys()].join(', ')}.`,
    );
    return null;
  }

  const field: ContentTypePlanField = {
    name,
    label: text(entry.label, 100) || humanise(name),
    type: fieldType.name,
    ...(entry.required === true ? { required: true } : {}),
    ...(entry.localized === true ? { localized: true } : {}),
    settings: asRecord(entry.settings),
    admin: admin(entry.admin),
  };
  if (!checkReferences(reader, field, where)) return null;

  const withIds = mapFieldTypeReferences(field, (value) => reader.idOf.get(value) ?? null);
  const settings = await checkSettings(reader, withIds, fieldType, where, 0);
  if (!settings) return null;
  return mapFieldTypeReferences(
    { ...field, settings },
    (value) => reader.nameOf.get(value) ?? null,
  );
}

/** Each reference, sub-fields included, must be planned or existing, and of the right kind. */
function checkReferences(reader: FieldReader, field: ContentTypePlanField, where: string): boolean {
  let broken = false;
  for (const reference of fieldTypeReferences(field)) {
    const kind = targetOf(reader, reference.name);
    if (!kind) {
      reader.problems.push(
        `The ${where} refers to "${reference.name}", which is neither designed here nor an existing type.`,
      );
      broken = true;
    } else if (kind !== reference.target) {
      reader.problems.push(
        `The ${where} refers to "${reference.name}" in "${reference.key}", but that must be a ${reference.target === 'block' ? 'block type' : 'document type'}.`,
      );
      broken = true;
    } else if (!reader.plannedKinds.has(reference.name)) {
      reader.reused.add(reference.name);
    }
  }
  return !broken;
}

/** A field's checked settings (references as ids), sub-fields recursing; `null` once reported. */
async function checkSettings(
  reader: FieldReader,
  field: { type: string; settings?: Record<string, unknown> | undefined },
  fieldType: AnyFieldType,
  where: string,
  depth: number,
): Promise<Record<string, unknown> | null> {
  const { problems } = reader;
  // A block field with no types would accept every block, so drop it.
  if ((field.type === 'blocks' || field.type === 'block') && !fieldTypeReferences(field).length) {
    problems.push(`The ${where} is a block field but names no block types.`);
    return null;
  }
  let settings = field.settings ?? {};
  if (fieldType.subFields) {
    if (depth + 1 > MAX_SUB_FIELD_DEPTH) {
      problems.push(
        `The ${where} nests repeaters too deep; a repeater may hold one more, no deeper.`,
      );
      return null;
    }
    const subFields = await readSubFields(reader, settings.fields, where, depth + 1);
    if (!subFields.length) {
      problems.push(`The ${where} is a repeater but has no usable sub-fields.`);
      return null;
    }
    settings = { ...settings, fields: subFields };
  }
  const checked = await validateFieldSettings(fieldType, settings);
  if (!checked.issues.isEmpty) {
    const issues = checked.issues.all
      .map((issue) => `${(issue.path ?? []).join('.') || 'settings'}: ${issue.key}`)
      .join('; ');
    problems.push(`The settings of the ${where} are not valid for "${field.type}" (${issues}).`);
    return null;
  }
  return compactSettings(checked.settings);
}

/** A repeater's sub-fields; broken ones are reported and left out. */
async function readSubFields(
  reader: FieldReader,
  raw: unknown,
  parent: string,
  depth: number,
): Promise<Array<Record<string, unknown>>> {
  const { problems, fieldTypes } = reader;
  const out: Array<Record<string, unknown>> = [];
  const names = new Set<string>();
  for (const [index, item] of (Array.isArray(raw) ? raw : []).entries()) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const where = `sub-field "${name || index}" of the ${parent}`;
    if (!isMachineName(name)) {
      problems.push(`The ${where} does not have a valid machine name.`);
      continue;
    }
    if (names.has(name)) continue;
    const fieldType = fieldTypes.get(String(entry.type ?? ''));
    if (!fieldType) {
      problems.push(
        `The ${where} has the type "${String(entry.type)}", which does not exist. Use one of: ${[...fieldTypes.keys()].join(', ')}.`,
      );
      continue;
    }
    const { zone: _zone, ...placement } = admin(entry.admin);
    const subField = {
      name,
      label: text(entry.label, 100) || humanise(name),
      type: fieldType.name,
      ...(entry.required === true ? { required: true } : {}),
      settings: asRecord(entry.settings),
      admin: placement,
    };
    const settings = await checkSettings(reader, subField, fieldType, where, depth);
    if (!settings) continue;
    names.add(name);
    out.push({ ...subField, settings });
  }
  return out;
}

/** `- blocks: Blocks - A sequence of blocks. settings: {...}` */
function describeFieldType(type: AnyFieldType): string {
  const schema = settingsSchemaOf(type);
  const about = type.description ? ` - ${type.description}` : '';
  return `- "${type.name}" (${type.label})${about}${schema ? `. settings: ${schema}` : ''}`;
}

/** `- page (document, "Page"): title: string, body: richtext, sections: blocks [hero, text]` */
export function describeExisting(
  type: ContentTypeDefinition,
  all: readonly ContentTypeDefinition[],
): string {
  const nameOf = new Map(all.map((entry) => [entry.id, entry.name]));
  const fields = type.fields
    // Stored references are ids; the model knows the types by name.
    .map((field) => describeField(mapFieldTypeReferences(field, (id) => nameOf.get(id) ?? null)))
    .join(', ');
  const kind = type.kind === 'block' ? 'block' : type.kind === 'data' ? 'databag' : 'document';
  return `- "${type.name}" (${kind}, "${type.label}")${type.description ? ` - ${type.description}` : ''}${fields ? `: ${fields}` : ''}`;
}

/** `sections: blocks [hero, text]`, `quotes: repeater {quote: string, photo: asset}` */
function describeField(field: {
  name: string;
  type: string;
  settings?: Record<string, unknown> | undefined;
}): string {
  const raw = field.type === 'repeater' ? field.settings?.fields : undefined;
  if (Array.isArray(raw)) {
    const subFields = raw.filter(
      (entry): entry is { name: string; type: string } =>
        typeof entry?.name === 'string' && typeof entry?.type === 'string',
    );
    return `${field.name}: repeater {${subFields.map(describeField).join(', ')}}`;
  }
  const references = fieldTypeReferences(field).map((reference) => reference.name);
  return `${field.name}: ${field.type}${references.length ? ` [${references.join(', ')}]` : ''}`;
}

/** Drops `undefined` values. */
function compactSettings(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function flags(entry: Record<string, unknown>, isData: boolean): Partial<ContentTypePlanType> {
  const out: Partial<ContentTypePlanType> = {};
  const keys = isData
    ? (['isPublishable', 'requiresApproval'] as const)
    : ([
        'hasSlug',
        'isPublishable',
        'isVisibleInTree',
        'canBeVisibleInMenu',
        'requiresApproval',
      ] as const);
  for (const key of keys) {
    if (typeof entry[key] === 'boolean') out[key] = entry[key] as boolean;
  }
  // No approval without publishing.
  if (out.isPublishable === false) out.requiresApproval = false;
  return out;
}

function admin(raw: unknown): NonNullable<ContentTypePlanField['admin']> {
  const entry = asRecord(raw);
  const width = Number(entry.width);
  const snapped = Number.isFinite(width)
    ? WIDTHS.reduce((best, option) =>
        Math.abs(option - width) < Math.abs(best - width) ? option : best,
      )
    : 100;
  const help = text(entry.help, 300);
  return {
    zone: entry.zone === 'sidebar' ? 'sidebar' : 'main',
    width: snapped,
    ...(help ? { help } : {}),
  };
}

function pickIcon(raw: unknown, icons: readonly string[] | undefined): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const icon = raw.trim();
  if (icons?.length && !icons.includes(icon)) return undefined;
  return icon.slice(0, 64);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
