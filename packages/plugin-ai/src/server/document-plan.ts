import {
  type BlockGridValue,
  type BlockLayout,
  type BlockValue,
  type ContentTypeDefinition,
  type ContentTypeRegistry,
  type FieldDefinition,
  type FieldInput,
  type FieldItem,
  isMachineName,
  normaliseField,
} from '@manablox/core';
import { uuid } from '@manablox/core/node';
import { AI_STYLE_GROUPS } from '../sdk.js';
import {
  type AiBlockFieldSpec,
  type AiBlockTypeSpec,
  type AiImageFieldSpec,
  type AiRepeaterFieldSpec,
  textValues,
} from './prompt.js';
import type { AiDocumentImage } from './services/ai.service.js';

/** Pure planning for document generation: which fields to ask for, and reading the answer back. */

/** The type's text fields, prefixed with a synthetic title field. */
export function writableTextFields(type: ContentTypeDefinition): FieldDefinition[] {
  const fields = type.fields.filter(
    (field) => field.type === 'string' || field.type === 'richtext',
  );
  // Keep a type's own `title` field rather than adding a second.
  if (fields.some((field) => field.name === TITLE_FIELD.name)) return fields;
  return [TITLE_FIELD, ...fields];
}

/**
 * The type's block fields with their offered types. Types without text fields are still
 * offered (e.g. a divider). Only one level deep: nested block fields are left alone.
 */
export function blockFieldSpecs(
  type: ContentTypeDefinition,
  registry: ContentTypeRegistry,
): AiBlockFieldSpec[] {
  const specs: AiBlockFieldSpec[] = [];

  for (const field of type.fields) {
    const single = field.type === 'block';
    if (!single && field.type !== 'blocks') continue;

    const settings = field.settings as {
      type?: string;
      types?: string[];
      min?: number;
      max?: number;
    };
    const ids = single ? [settings.type] : (settings.types ?? []);
    const types = ids
      .filter((id): id is string => typeof id === 'string')
      .map((id) => registry.tryGet(id))
      .filter((definition): definition is ContentTypeDefinition => Boolean(definition))
      .map(
        (definition): AiBlockTypeSpec => ({
          id: definition.id,
          name: definition.name,
          label: definition.label,
          description: definition.description ?? null,
          fields: definition.fields.filter(isTextField),
          images: imageFieldSpecs(definition.fields),
          repeaters: repeaterFieldSpecs(definition.fields),
        }),
      );

    if (!types.length) continue;
    specs.push({
      name: field.name,
      label: field.label,
      single,
      ...(settings.min === undefined ? {} : { min: settings.min }),
      ...(settings.max === undefined ? {} : { max: settings.max }),
      types,
      grid: !single,
    });
  }

  return specs;
}

/** Repeater fields with text sub-fields; items get text only, other sub-fields their defaults. */
export function repeaterFieldSpecs(fields: FieldDefinition[]): AiRepeaterFieldSpec[] {
  const specs: AiRepeaterFieldSpec[] = [];
  for (const field of fields) {
    if (field.type !== 'repeater') continue;
    const settings = field.settings as { fields?: unknown; min?: number; max?: number };
    const raw = Array.isArray(settings.fields) ? settings.fields : [];
    const subFields = raw
      .filter(
        (entry): entry is FieldInput =>
          typeof entry?.name === 'string' && isMachineName(entry.name) && isTextField(entry),
      )
      .map((entry, index) => normaliseField(field.name, entry, index));
    if (!subFields.length) continue;
    specs.push({
      name: field.name,
      label: field.label,
      ...(settings.min === undefined ? {} : { min: settings.min }),
      ...(settings.max === undefined ? {} : { max: settings.max }),
      fields: subFields,
    });
  }
  return specs;
}

/** Reads a repeater answer (a list of `{ <field>: value }`) into items with fresh ids. */
export function itemsFromAnswer(spec: AiRepeaterFieldSpec, answer: unknown): FieldItem[] {
  const allowed = new Set(spec.fields.map((field) => field.name));
  const items: FieldItem[] = [];
  for (const entry of Array.isArray(answer) ? answer : []) {
    if (!entry || typeof entry !== 'object') continue;
    // Accept `{ fields: {...} }` as well as the bare field map.
    const nested = (entry as { fields?: unknown }).fields;
    const source = nested && typeof nested === 'object' ? nested : entry;
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(textValues(source as Record<string, unknown>))) {
      if (allowed.has(name)) values[name] = value;
    }
    if (!Object.keys(values).length) continue;
    items.push({ itemId: uuid(), fields: values });
    if (spec.max !== undefined && items.length >= spec.max) break;
  }
  return items;
}

/** The parsed answer for one block field. */
export interface AiBlockFieldAnswer {
  blocks: BlockValue[];
  /** Absent when the model gave no valid grid. */
  grid?: BlockGridValue | undefined;
  images: AiDocumentImage[];
}

/**
 * Reads a block field answer (a list, one block, or `{ grid, blocks }`) into block values.
 * Unknown types, unknown fields and non-text values are dropped.
 */
export function blocksFromAnswer(spec: AiBlockFieldSpec, answer: unknown): AiBlockFieldAnswer {
  const wrapper =
    answer && typeof answer === 'object' && !Array.isArray(answer)
      ? (answer as { grid?: unknown; blocks?: unknown })
      : null;
  // An object without `blocks` is a single block.
  const list = wrapper && 'blocks' in wrapper ? wrapper.blocks : answer;
  const entries = Array.isArray(list) ? list : list ? [list] : [];

  const columns = spec.grid ? readColumns(wrapper?.grid) : null;
  const blocks: BlockValue[] = [];
  const images: AiDocumentImage[] = [];
  const taken: boolean[][] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const {
      block,
      fields,
      images: pictures,
      layout,
    } = entry as {
      block?: unknown;
      fields?: unknown;
      images?: unknown;
      layout?: unknown;
    };

    // An unnamed block takes the first type.
    const named = typeof block === 'string' ? block : null;
    const type = named
      ? spec.types.find((candidate) => candidate.name === named)
      : (spec.types[0] as AiBlockTypeSpec | undefined);
    if (!type) continue;

    const written =
      fields && typeof fields === 'object' ? textValues(fields as Record<string, unknown>) : {};
    const allowed = new Set(type.fields.map((field) => field.name));
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(written)) {
      if (allowed.has(name)) values[name] = value;
    }
    for (const repeater of type.repeaters ?? []) {
      const items = itemsFromAnswer(
        repeater,
        (fields as Record<string, unknown> | null)?.[repeater.name],
      );
      if (items.length) values[repeater.name] = items;
    }

    const blockId = uuid();
    const placement = columns ? readLayout(layout, columns, taken) : undefined;
    blocks.push({
      blockId,
      type: type.id,
      fields: values,
      ...(placement ? { layout: placement } : {}),
    });

    for (const picture of readImages(pictures, type.images)) {
      images.push({
        ...picture,
        field: spec.name,
        blockId,
        blockField: picture.name,
        label: `${type.label}: ${picture.label}`,
      });
    }

    if (spec.single) break;
    if (spec.max !== undefined && blocks.length >= spec.max) break;
  }

  return {
    blocks,
    images,
    ...(columns
      ? {
          grid: {
            desktop: { columns },
            tablet: { columns: Math.min(columns, 2) },
            mobile: { columns: 1 },
          },
        }
      : {}),
  };
}

/** Image briefs from an answer, for the offered asset fields. */
export function readImages(
  answer: unknown,
  offered: AiImageFieldSpec[],
): Array<{ name: string; label: string; prompt: string; aspectRatio?: string }> {
  if (!answer || typeof answer !== 'object' || !offered.length) return [];
  const out: Array<{ name: string; label: string; prompt: string; aspectRatio?: string }> = [];

  for (const field of offered) {
    const raw = (answer as Record<string, unknown>)[field.name];
    // Accept `{ prompt, aspect }` or a bare string.
    const prompt = typeof raw === 'string' ? raw : (raw as { prompt?: unknown } | null)?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) continue;

    const aspect = typeof raw === 'object' ? (raw as { aspect?: unknown }).aspect : undefined;
    const ratio = typeof aspect === 'string' && IMAGE_RATIOS.includes(aspect) ? aspect : undefined;
    out.push({
      name: field.name,
      label: field.label,
      prompt: prompt.trim(),
      ...(ratio ? { aspectRatio: ratio } : {}),
    });
  }

  return out;
}

/** Aspect ratios the image dialog offers. */
export const IMAGE_RATIOS: readonly string[] =
  AI_STYLE_GROUPS.find((group) => group.id === 'aspectRatio')?.options.map((option) => option.id) ??
  [];

/** The model's column count, clamped. */
function readColumns(grid: unknown): number | null {
  const raw = typeof grid === 'number' ? grid : (grid as { columns?: unknown } | null)?.columns;
  const columns = typeof raw === 'number' ? Math.round(raw) : Number.NaN;
  if (!Number.isFinite(columns) || columns < 1) return null;
  return Math.min(columns, MAX_GRID_COLUMNS);
}

/** Matches the blocks field type's limit. */
const MAX_GRID_COLUMNS = 12;
const MAX_GRID_ROWS = 100;

/** A block's placement, or undefined if it overflows the grid or overlaps another block. */
function readLayout(layout: unknown, columns: number, taken: boolean[][]): BlockLayout | undefined {
  if (!layout || typeof layout !== 'object') return undefined;
  const raw = layout as Record<string, unknown>;

  const column = positive(raw.column) ?? 1;
  const row = positive(raw.row) ?? 1;
  const columnSpan = Math.min(positive(raw.columnSpan) ?? 1, columns);
  const rowSpan = positive(raw.rowSpan) ?? 1;

  if (column + columnSpan - 1 > columns) return undefined;
  if (row + rowSpan - 1 > MAX_GRID_ROWS) return undefined;

  for (let r = row; r < row + rowSpan; r++) {
    for (let c = column; c < column + columnSpan; c++) {
      if (taken[r]?.[c]) return undefined;
    }
  }
  for (let r = row; r < row + rowSpan; r++) {
    taken[r] ??= [];
    for (let c = column; c < column + columnSpan; c++) (taken[r] as boolean[])[c] = true;
  }

  return { column, row, columnSpan, rowSpan };
}

function positive(value: unknown): number | null {
  const number = typeof value === 'number' ? Math.round(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

const isTextField = (field: Pick<FieldDefinition, 'type'>): boolean =>
  field.type === 'string' || field.type === 'richtext';

/** Asset fields that accept images. */
export function imageFieldSpecs(fields: FieldDefinition[]): AiImageFieldSpec[] {
  return fields
    .filter((field) => {
      if (field.type !== 'asset') return false;
      const accept = (field.settings as { accept?: string[] }).accept ?? [];
      return !accept.length || accept.some((entry) => entry.startsWith('image'));
    })
    .map((field) => ({ name: field.name, label: field.label }));
}

/** Whether an asset field holds a list. */
export function isMultipleAsset(field: FieldDefinition | undefined): boolean {
  return (field?.settings as { multiple?: boolean } | undefined)?.multiple === true;
}

/** Synthetic field for the document's title. */
export const TITLE_FIELD: FieldDefinition = {
  id: 'title',
  name: 'title',
  label: 'Title',
  type: 'string',
  settings: { max: 200 },
  required: true,
  localized: true,
  unique: false,
  admin: { zone: 'main', position: 0, width: 100 },
};
