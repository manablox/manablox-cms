import type { ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type DesignNode,
  nodeRef as designNodeRef,
  generateBlockDesign,
  type InstanceStyle,
  type SiteDesignKind,
  type SiteRenderInput,
  subFieldsOf,
} from '@manablox/site';
import type { VNodeChild } from 'vue';
import type { FieldDef, IslandName, MarkerPath, RenderOptions } from './types.js';
import { isRecord } from './util.js';

/** One render: the input plus what the render collects. */
export interface RenderContext {
  input: SiteRenderInput;
  options: RenderOptions;
  locale: string;
  canvas: boolean;
  islands: Set<IslandName>;
  instanceStyles: Map<string, InstanceStyle>;
  /** Block type definitions by id and by name. */
  types: Map<string, ContentTypeDefinition>;
  generated: Map<string, BlockDesign>;
  /** Form element ids on the page, to keep repeated forms apart. */
  formIds: Set<string>;
  now: number;
}

/** The current entry of an enclosing `repeat`. */
export interface RepeatFrame {
  item: unknown;
  index: number;
  /** The list field. */
  def: FieldDef | null;
  /** Sub-fields of a repeater item. */
  subDefs: FieldDef[];
  /** Marker path of the entry. */
  path: MarkerPath | null;
}

/** Where bound values come from: the document, a block, a repeater item. */
export interface DataScope {
  fields: Record<string, unknown>;
  defs: readonly FieldDef[];
  /** Marker path of the scope's owner; `[]` for the document, `null` when not editable. */
  path: MarkerPath | null;
  /** By the repeat's bound path. */
  repeats: ReadonlyMap<string, RepeatFrame>;
  /** Document meta bindings (`$title`, ...) resolve here. */
  document: boolean;
}

interface FormFrame {
  /** `<designKind>:<designKey>:<nodeId>`. */
  ref: string;
  id: string;
  defs: readonly FieldDef[];
  /** A bound form: the fields its input repeats for; `null` for a form with fixed inputs. */
  each: readonly FieldDef[] | null;
  successMessage: string;
  /** Field errors of a post without JavaScript, by field name. */
  errors: Readonly<Record<string, string>>;
}

/** Position in the tree while rendering. */
export interface Frame {
  kind: SiteDesignKind;
  key: string;
  data: DataScope;
  form?: FormFrame | undefined;
  /** The page body, for a layout's `slot`. */
  slot?: (() => VNodeChild) | undefined;
  /** Canvas: nodes of this design get markers; others only when no focus is set. */
  markers: boolean;
}

export function createContext(input: SiteRenderInput, options: RenderOptions): RenderContext {
  const types = new Map<string, ContentTypeDefinition>();
  for (const type of Object.values(input.contentTypes ?? {})) {
    if (!isRecord(type)) continue;
    types.set(type.id, type);
    if (!types.has(type.name)) types.set(type.name, type);
  }
  return {
    input,
    options,
    locale: input.locale || input.space?.defaultLocale || 'en',
    canvas: input.mode === 'canvas',
    islands: new Set(),
    instanceStyles: new Map(),
    types,
    generated: new Map(),
    formIds: new Set(),
    now: options.now ?? Date.now(),
  };
}

export function fieldDefs(
  type: Pick<ContentTypeDefinition, 'fields'> | null | undefined,
): FieldDef[] {
  return (type?.fields ?? []).map((field) => ({
    id: field.id,
    name: field.name,
    type: field.type,
    label: field.label,
    required: field.required,
    settings: isRecord(field.settings) ? field.settings : {},
  }));
}

export function subFieldDefs(def: FieldDef | null): FieldDef[] {
  if (def?.type !== 'repeater') return [];
  return subFieldsOf({ settings: def.settings ?? {} }).map((field) => ({
    id: field.id,
    name: field.name,
    type: field.type,
    label: field.label,
    required: field.required,
    settings: field.settings,
  }));
}

export function findDef(defs: readonly FieldDef[], idOrName: string): FieldDef | null {
  return (
    defs.find((def) => def.id === idOrName) ?? defs.find((def) => def.name === idOrName) ?? null
  );
}

/** The design a block type renders with: stored, else generated from its fields. */
export function blockDesignFor(ctx: RenderContext, typeId: string): BlockDesign | null {
  const stored = ctx.input.blockDesigns?.[typeId];
  if (stored) return stored;
  const cached = ctx.generated.get(typeId);
  if (cached) return cached;
  const type = ctx.types.get(typeId);
  if (!type) return null;
  const generated = generateBlockDesign(type);
  ctx.generated.set(typeId, generated);
  return generated;
}

/** The variant root: `wanted` when it exists, else the design's default, else the first. */
export function variantRoot(design: BlockDesign, wanted?: string | null): DesignNode | null {
  const variants = design.variants ?? {};
  const pick = (name: string | null | undefined) =>
    name && Object.hasOwn(variants, name) ? (variants[name]?.root ?? null) : null;
  return pick(wanted) ?? pick(design.default) ?? Object.values(variants)[0]?.root ?? null;
}

export function nodeRef(frame: Pick<Frame, 'kind' | 'key'>, node: Pick<DesignNode, 'id'>): string {
  return designNodeRef(frame.kind, frame.key, node.id);
}
