import type { Binding } from '@manablox/site';
import { type DataScope, type Frame, findDef, type RenderContext } from './context.js';
import type { FieldDef, MarkerPath } from './types.js';
import { isRecord } from './util.js';

export interface Resolved {
  value: unknown;
  def: FieldDef | null;
  /** Live-preview path of the field; `null` for values an editor cannot pick. */
  path: MarkerPath | null;
}

const PUBLISHED_AT: FieldDef = {
  id: '$publishedAt',
  name: 'publishedAt',
  type: 'date',
  settings: { mode: 'datetime' },
};

/** The values of a repeater item or block: `fields` when present, else the object itself. */
export function itemFields(item: unknown): Record<string, unknown> {
  if (!isRecord(item)) return {};
  return isRecord(item.fields) ? item.fields : item;
}

function fieldValue(fields: Record<string, unknown>, def: FieldDef): unknown {
  return Object.hasOwn(fields, def.name) ? fields[def.name] : fields[def.id];
}

function resolveMeta(field: string, frame: Frame, ctx: RenderContext): Resolved {
  const { input } = ctx;
  const doc = frame.data.document ? input.document : null;
  switch (field) {
    case '$title':
      return { value: doc?.title ?? null, def: null, path: doc ? ['title'] : null };
    case '$permalink':
      return { value: doc?.permalink ?? null, def: null, path: null };
    case '$publishedAt':
      return { value: doc?.publishedAt ?? null, def: PUBLISHED_AT, path: null };
    case '$author':
      return { value: doc?.author ?? null, def: null, path: null };
    case '$site.name':
      return { value: input.site?.name || input.space?.name || null, def: null, path: null };
    case '$site.logo':
      return { value: input.site?.logo?.assetId ?? null, def: null, path: null };
    default:
      return { value: null, def: null, path: null };
  }
}

/** Resolves a field path (`<id>`, `<repeat>.<sub>`, `<repeat>.$item`, `$meta`) in a scope. */
export function resolveField(field: string, frame: Frame, ctx: RenderContext): Resolved {
  if (field.startsWith('$')) return resolveMeta(field, frame, ctx);
  const scope: DataScope = frame.data;
  const segments = field.split('.');
  if (segments.length === 1) {
    const def = findDef(scope.defs, field);
    if (!def) return { value: scope.fields[field] ?? null, def: null, path: null };
    return {
      value: fieldValue(scope.fields, def) ?? null,
      def,
      path: scope.path ? [...scope.path, def.name] : null,
    };
  }
  const parent = segments.slice(0, -1).join('.');
  const last = segments[segments.length - 1] as string;
  const repeat = scope.repeats.get(parent);
  if (!repeat) return { value: null, def: null, path: null };
  if (last === '$item') return { value: repeat.item, def: repeat.def, path: repeat.path };
  const def = findDef(repeat.subDefs, last);
  const fields = itemFields(repeat.item);
  if (!def) return { value: fields[last] ?? null, def: null, path: null };
  return {
    value: fieldValue(fields, def) ?? null,
    def,
    path: repeat.path ? [...repeat.path, def.name] : null,
  };
}

export function resolveBinding(
  bind: Binding | undefined,
  frame: Frame,
  ctx: RenderContext,
): Resolved | null {
  if (!bind || typeof bind.field !== 'string' || !bind.field) return null;
  return resolveField(bind.field, frame, ctx);
}
