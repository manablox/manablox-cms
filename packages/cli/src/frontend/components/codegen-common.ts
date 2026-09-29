import { isIdentifier, pascalName } from '@manablox/public-sdk';
import type { FieldRender, ModelField, ModelType, RenderModel } from '../model.js';

/** Naming, per-field slots and imports shared by every framework's component writer. */

export interface NamedType extends ModelType {
  /** `TeaserBlock`; the suffix avoids import collisions. */
  component: string;
  /** `blog-post`, the DOM renderer file name. */
  file: string;
}

export interface NamedModel {
  blocks: NamedType[];
  contents: NamedType[];
}

export function nameTypes(model: RenderModel): NamedModel {
  return {
    blocks: name(
      model.types.filter((type) => type.kind === 'block'),
      'Block',
    ),
    contents: name(
      model.types.filter((type) => type.kind === 'content'),
      'Content',
    ),
  };
}

function name(types: ModelType[], suffix: string): NamedType[] {
  const components = new Set<string>();
  const files = new Set<string>();
  return types.map((type) => {
    const base = unique(pascalName(type.name), components);
    return {
      ...type,
      component: `${base}${suffix}`,
      file: unique(kebab(base), files, '-'),
    };
  });
}

function kebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function unique(candidate: string, taken: Set<string>, separator = ''): string {
  let chosen = candidate;
  for (let index = 2; taken.has(chosen); index += 1) chosen = `${candidate}${separator}${index}`;
  taken.add(chosen);
  return chosen;
}

/** `fields.ts` helper per render kind. */
const HELPER: Record<FieldRender, string | null> = {
  text: 'text',
  date: 'date',
  richtext: 'html',
  json: 'json',
  user: 'users',
  asset: 'assets',
  content: 'documents',
  link: 'link',
  block: 'blockOf',
  items: 'items',
  // Passed to the list renderer as is.
  blocks: null,
};

export interface Slot {
  field: ModelField;
  local: string;
  /** Quoted field name, for click-to-edit paths. */
  key: string;
  /** True for the first title-like text field. */
  heading: boolean;
}

/** Names a local must not take: props, imports and reserved words. */
const TAKEN = new Set(
  [
    ...Object.values(HELPER).filter((helper): helper is string => helper !== null),
    'href',
    'block',
    'path',
    'node',
    'props',
    'fields',
    'item',
    'index',
    'asset',
    'entry',
    'computed',
    'fieldAttribute',
    'assetUrl',
    'isImage',
    'blocksOf',
    'gridOf',
    'blockRenderers',
    'renderBlock',
    'renderBlocks',
    'renderAsset',
    'el',
    'Astro',
    'Blocks',
    'Fragment',
    'Block',
    'Asset',
    'React',
    'Math',
    'JSON',
    'Object',
    'String',
    'Number',
    'Array',
    'Date',
    'undefined',
    'window',
    'document',
    'console',
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield await implements interface package private protected public static arguments eval'.split(
      ' ',
    ),
  ].flat(),
);

export function slotsFor(type: ModelType): Slot[] {
  const used = new Set<string>();
  let heading = false;
  return type.fields.map((field) => {
    const base = camel(field.name);
    let local = TAKEN.has(base) ? `${base}Value` : base;
    for (let index = 2; used.has(local) || TAKEN.has(local); index += 1) {
      local = `${base}${index}`;
    }
    used.add(local);
    const isHeading =
      !heading &&
      field.render === 'text' &&
      !field.list &&
      /title|headline|heading/i.test(field.name);
    if (isHeading) heading = true;
    return { field, local, key: quote(field.name), heading: isHeading };
  });
}

function camel(name: string): string {
  const [first = '', ...rest] = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const joined =
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  if (!joined) return 'value';
  return /^[0-9]/.test(joined) ? `field${joined}` : joined;
}

export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `block.headline`, or `block['hero-image']`. */
export function access(base: string, name: string): string {
  return isIdentifier(name) ? `${base}.${name}` : `${base}[${quote(name)}]`;
}

/** The helper call that reads a field. */
export function reader(slot: Slot, raw: string): string {
  const helper = HELPER[slot.field.render];
  return helper ? `${helper}(${raw})` : raw;
}

/** `fields.ts` helpers used by the slots, sorted. */
export function helpersFor(slots: Slot[]): string[] {
  const names = new Set<string>();
  for (const slot of slots) {
    const helper = HELPER[slot.field.render];
    if (helper) names.add(helper);
    if (slot.field.render === 'content') names.add('href');
    for (const sub of subSlots(slot)) names.add(sub.helper);
  }
  return [...names].sort();
}

/** A repeater item's sub-field, read from the loop's `item`. */
export interface SubSlot {
  /** `text(item.fields.question)`. */
  value: string;
  helper: 'text' | 'json';
  tag: 'p' | 'pre';
  /** Quoted sub-field name. */
  key: string;
}

/** Text sub-fields as text, anything else as JSON. */
export function subSlots(slot: Slot): SubSlot[] {
  return (slot.field.fields ?? []).map((sub) => {
    const helper = sub.render === 'text' ? 'text' : 'json';
    return {
      value: `${helper}(${access('item.fields', sub.name)})`,
      helper,
      tag: helper === 'text' ? 'p' : 'pre',
      key: quote(sub.name),
    };
  });
}

/** A sub-field's path inside the item at `index`, from the repeater's own path. */
export function itemPath(path: string, sub: SubSlot): string {
  return `${path.slice(0, -1)}, index, ${sub.key}]`;
}

export function uses(slots: Slot[], render: FieldRender): boolean {
  return slots.some((slot) => slot.field.render === render);
}

/** Header comment of a generated component. */
function describe(type: NamedType): string[] {
  const what = type.kind === 'block' ? 'block' : 'content type';
  return [
    `The \`${type.name}\` ${what} (${type.label}), one element per field. Written by`,
    "`manablox frontend` from the space's content model: a starting point to edit, not a",
    'file to keep in step. A field that is empty renders nothing.',
  ];
}

/** An import line, names sorted like Biome. */
export function importLine(names: string[], from: string): string {
  const sorted = [...names].sort((a, b) => {
    const key = (entry: string) => entry.replace(/^type /, '').toLowerCase();
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  if (sorted.every((entry) => entry.startsWith('type '))) {
    return `import type { ${sorted.map((entry) => entry.slice(5)).join(', ')} } from '${from}';`;
  }
  const line = `import { ${sorted.join(', ')} } from '${from}';`;
  return line.length <= 100
    ? line
    : `import {\n${sorted.map((entry) => `  ${entry},`).join('\n')}\n} from '${from}';`;
}

/** Import lines in Biome's order: packages, then relative paths by source. */
export function orderImports(lines: string[]): string[] {
  const source = (line: string) => /from '([^']+)';$/.exec(line)?.[1] ?? '';
  const rank = (line: string) => (source(line).startsWith('.') ? 1 : 0);
  return [...lines].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return source(a) < source(b) ? -1 : source(a) > source(b) ? 1 : 0;
  });
}

/** A slot's field path: under the block's `path`, or from the document root. */
export function fieldPath(type: NamedType, slot: Slot): string {
  return type.kind === 'block' ? `[...path, ${slot.key}]` : `[${slot.key}]`;
}

/** The doc comment of a generated component, with an optional rich text note. */
export function docComment(type: NamedType, slots: Slot[], richtextNote?: string): string[] {
  return [
    '/**',
    ...describe(type).map((line) => ` * ${line}`),
    ...(richtextNote && uses(slots, 'richtext') ? [' *', ` * ${richtextNote}`] : []),
    ' */',
  ];
}

/** The local holding a single block's component, e.g. `FeatureRenderer`. */
export function rendererName(slot: Slot): string {
  return `${slot.local.charAt(0).toUpperCase()}${slot.local.slice(1)}Renderer`;
}

export function indent(text: string, by: number): string {
  const pad = ' '.repeat(by);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
