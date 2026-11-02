import type { ContentTypeDefinition, FieldDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type DesignNode,
  ELEMENTS,
  findBrokenBindings,
  findUnplacedFields,
  generateBlockDesign,
  NODE_ID,
  newNodeId,
  STYLE_PROP_NAMES,
  subFieldsOf,
  type ThemeDesign,
  validateSiteDesign,
} from '@manablox/site';

/**
 * Block design: an element tree per variant for one block type, bound to its fields by id and
 * styled with the space's theme tokens. Node ids are filled in; everything else is checked
 * with the site validators and sent back when wrong.
 */

export interface SiteBlockDesignContext {
  type: Pick<ContentTypeDefinition, 'id' | 'name' | 'label' | 'description' | 'fields'>;
  theme: ThemeDesign;
  /** Locale codes static text is written in; the first is the default. */
  locales: readonly string[];
  /** The design to start from; the generated one when absent. */
  current?: BlockDesign | null | undefined;
}

export interface SiteBlockDesign {
  /** `null` when no answer made a valid design. */
  design: BlockDesign | null;
  notes: string;
  /** Top-level fields no element shows. */
  unplaced: string[];
}

/** Elements a block design may use; chrome is for layouts, forms need a databag. */
const BLOCK_ELEMENTS = Object.entries(ELEMENTS)
  .filter(([, info]) => info.category !== 'chrome' && info.category !== 'form')
  .map(([name]) => name);

export const SITE_BLOCK_DESIGN_SYSTEM = [
  "You design how content blocks look on websites built with Manablox: an element tree bound to the block's fields and styled only with the site's design tokens.",
  'You answer with one JSON object and nothing else: no markdown fence, no commentary.',
].join(' ');

/** The instruction for a block design. */
export function composeSiteBlockDesignPrompt(
  request: string,
  context: SiteBlockDesignContext,
): string {
  const { type, theme } = context;
  const locale = context.locales[0] ?? 'en';
  const start = context.current ?? generateBlockDesign(type);
  return [
    `Design the block type "${type.name}" (${type.label})${type.description ? ` - ${type.description}` : ''}.`,
    `Its fields, bound by id:\n${describeFields(type.fields).join('\n')}`,
    [
      'Elements:',
      '- A node is {"id", "el", "bind"?, "props"?, "style"?, "children"?, "visibility"?}. "id" is unique in the design: a letter, then letters, digits, "-" or "_".',
      `- "el" is one of: ${BLOCK_ELEMENTS.join(', ')}. Only box, stack, grid, section, link and repeat take children.`,
      '- "bind": {"field": "<field id>"} shows a field: heading or text for short text, richtext for rich text, image for images, button or link for links, repeat for repeater lists (its children bind "<repeater id>.<sub-field id>"; a plain list item binds "<field id>.$item"), blocks or block for nested blocks.',
      '- An unbound heading, text or button shows static "props": {"text": {"<locale>": "..."}}. heading takes "level" 1 to 6; button takes "variant" primary, secondary or ghost and "href".',
      '- "visibility": {"whenField": "<field id>"} hides a node while that field is empty; {"breakpoints": ["desktop", "tablet", "mobile"]} lists where it shows.',
    ].join('\n'),
    [
      'Style:',
      '- "style" is {"base": {...}, "tablet": {...}, "mobile": {...}, "hover": {...}, "focus": {...}, "active": {...}}; base is desktop, tablet and mobile override it below 1024px and 640px.',
      `- Style props: ${STYLE_PROP_NAMES.join(', ')}.`,
      `- Colors are "color:<role>" or "color:<role>/<opacity 0-100>" with roles ${Object.keys(theme.colors.roles).join(', ')}.`,
      `- Spacing (padding*, margin*, gap) is "space:<step>" with steps ${Object.keys(theme.space).join(', ')}, or "0"; margins also "auto".`,
      `- "type" is "type:<step>" (${Object.keys(theme.type).join(', ')}); "font" is "font:heading", "font:body" or "font:mono"; "radius" is "radius:<name>" (${Object.keys(theme.radius).join(', ')}); "shadow" is "shadow:<name>" (${Object.keys(theme.shadow).join(', ')}) or "none".`,
      '- Sizes (width, maxWidth, minHeight, ...) take a unit: "20rem", "50%"; maxWidth and width also take "container:<name>". "direction" is row or column, "align" start, center, end, stretch or baseline, "justify" start, center, end, between, around or evenly, "columns" 1 to 12, "aspectRatio" like "16/9".',
      '- Stack elements into a column on mobile when they sit side by side on desktop.',
    ].join('\n'),
    `Static text is written for the locale "${locale}".`,
    'Offer one variant, "default", unless the request asks for more; each variant has a "label" and a "root" node.',
    `The current design, to improve or replace:\n${JSON.stringify(start)}`,
    'Answer with a single JSON object: {"variants": {"default": {"label": "Default", "root": {...}}}, "default": "default", "notes": "<one or two sentences on the design>"}.',
    `The request: ${request.trim() || 'A clean, well-spaced design that shows every field.'}`,
  ].join('\n\n');
}

/** Reads and checks a block design; problems are sent back on retry. */
export async function readSiteBlockDesign(
  answer: Record<string, unknown>,
  context: SiteBlockDesignContext,
): Promise<{ value: SiteBlockDesign; problems: string[] }> {
  const problems: string[] = [];
  const draft = {
    variants: answer.variants,
    default: typeof answer.default === 'string' ? answer.default : 'default',
  } as BlockDesign;
  fillNodeIds(draft);

  const result = validateSiteDesign('block', draft);
  if (!result.ok) {
    for (const issue of result.issues.slice(0, 25))
      problems.push(`"${issue.path}" ${issue.message}.`);
  }
  const design = result.ok ? result.value : null;
  if (design) {
    for (const broken of findBrokenBindings(design, context.type)) {
      problems.push(
        `Node "${broken.nodeId}" binds "${broken.field}", which is not a field of this block.`,
      );
    }
  }
  const unplaced = design
    ? findUnplacedFields(design, context.type).map((field) => field.name)
    : [];

  return {
    value: {
      design,
      notes: typeof answer.notes === 'string' ? answer.notes.trim().slice(0, 1000) : '',
      unplaced,
    },
    problems,
  };
}

/** Gives nodes without a usable or unique id a fresh one, so a model need not invent them. */
function fillNodeIds(design: BlockDesign): void {
  if (!design.variants || typeof design.variants !== 'object') return;
  const nodes = (node: unknown, out: DesignNode[] = []): DesignNode[] => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return out;
    out.push(node as DesignNode);
    const children = (node as DesignNode).children;
    if (Array.isArray(children)) for (const child of children) nodes(child, out);
    return out;
  };
  for (const variant of Object.values(design.variants)) {
    const all = nodes((variant as { root?: unknown } | null)?.root);
    const taken = new Set(
      all.map((node) => node.id).filter((id) => typeof id === 'string' && NODE_ID.test(id)),
    );
    const seen = new Set<string>();
    for (const node of all) {
      if (typeof node.id !== 'string' || !NODE_ID.test(node.id) || seen.has(node.id)) {
        node.id = newNodeId(taken);
        taken.add(node.id);
      }
      seen.add(node.id);
    }
  }
}

function describeFields(fields: readonly FieldDefinition[], prefix = ''): string[] {
  return fields.flatMap((field) => {
    const id = prefix ? `${prefix}.${field.id}` : field.id;
    const line = `- "${id}": ${field.name} (${field.label}), ${field.type}${field.required ? ', required' : ''}`;
    if (field.type !== 'repeater') return [line];
    const sub = subFieldsOf(field) as unknown as FieldDefinition[];
    return [
      `${line}, a list of items with:`,
      ...describeFields(sub, id).map((entry) => `  ${entry}`),
    ];
  });
}
