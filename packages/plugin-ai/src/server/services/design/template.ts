import {
  type BlockGridValue,
  type BlockValue,
  type ContentTypeDefinition,
  type ContentTypePlan,
  normaliseField,
} from '@manablox/core';
import { stableId } from '@manablox/core/node';
import { blocksFromAnswer, repeaterFieldSpecs } from '../../document-plan.js';
import type { AiBlockFieldSpec, AiBlockTypeSpec } from '../../prompt.js';
import {
  type ContentTypeDesignContext,
  composeContentTypeDesignPrompt,
  readContentTypeDesign,
} from './content-types.js';

/** Template design: a block layout with sample copy, plus any new block types it needs, in one answer. */

export interface TemplateDesign {
  /** New block types to create first. */
  plan: ContentTypePlan;
  title: string;
  /** Blocks in reading order; new types already use the ids the plan will create. */
  blocks: BlockValue[];
  grid: BlockGridValue | null;
  /** New block type id -> name, for previews. */
  newTypes: Record<string, string>;
  notes: string;
}

export const TEMPLATE_DESIGN_SYSTEM = [
  'You design page templates for Manablox, a headless CMS: a starting layout of blocks an editor picks when creating a document, filled with sample copy that shows what belongs in each block.',
  'You answer with one JSON object and nothing else: no markdown fence, no commentary.',
].join(' ');

export function composeTemplateDesignPrompt(
  request: string,
  context: ContentTypeDesignContext & { locale?: string | null | undefined },
): string {
  const blocks = context.existing.filter((type) => type.kind === 'block');
  const existing = blocks.length
    ? [
        'The block types this space already has, with the fields each one is filled in with:',
        ...blocks.map(
          (type) =>
            `- "${type.name}" (${type.label})${type.description ? ` - ${type.description}` : ''}: ${
              [
                ...type.fields.filter(isText).map(describeText),
                ...repeaterFieldSpecs(type.fields).map(
                  (spec) =>
                    `"${spec.name}" (a list of items, each {${spec.fields.map(describeText).join(', ')}})`,
                ),
              ].join(', ') || 'nothing to fill in'
            }`,
        ),
      ].join('\n')
    : 'The space has no block types yet; design the ones the template needs.';

  // Reuse the content model rules, scoped to block types.
  const typeRules = composeContentTypeDesignPrompt(request, { ...context, scope: 'block' })
    .split('\n\n')
    .filter((part) => part.startsWith('Rules:') || part.startsWith('Field types:'));

  return [
    'A template is a document of blocks. Lay one out for the request: choose the blocks it needs in reading order, place them on a grid, and fill each one with sample copy that shows an editor what belongs there - realistic, specific to the request, never lorem ipsum.',
    existing,
    'Use the existing block types wherever one fits. Where a section the template needs has no fitting block type, design a new block type for it under "blockTypes" and use it by name like any other.',
    ...typeRules,
    'Lay the blocks out on a grid of 1 to 12 columns - 2, 3 or 4 read well - and place each with "layout": {"column": <first column, from 1>, "row": <first row, from 1>, "columnSpan": <columns>, "rowSpan": <rows>}. A block that opens or closes the page usually spans the full width; short blocks sit side by side. No two blocks may overlap.',
    context.locale ? `Write the sample copy in the locale "${context.locale}".` : '',
    'Answer with a single JSON object: {"blockTypes": [<new block types, possibly none>], "title": "<the template\'s name>", "grid": {"columns": N}, "blocks": [{"block": "<block type name>", "fields": {<its text fields, and each list as [{<its text fields>}, ...]>}, "layout": {...}}, ...], "notes": "<one or two sentences to the editor>"}.',
    `The request: ${request.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Reads new block types, then the blocks against existing and new types. */
export async function readTemplateDesign(
  answer: Record<string, unknown>,
  context: ContentTypeDesignContext & { spaceId: string },
): Promise<{ value: TemplateDesign; problems: string[] }> {
  const hasNewTypes = Array.isArray(answer.blockTypes) && answer.blockTypes.length > 0;
  const design = hasNewTypes
    ? await readContentTypeDesign({ types: answer.blockTypes }, { ...context, scope: 'block' })
    : { value: { plan: { types: [] }, reused: [], notes: '' }, problems: [] };
  const problems = [...design.problems];

  const offered: AiBlockTypeSpec[] = [
    ...context.existing
      .filter((type) => type.kind === 'block')
      .map((type) => blockSpec(type.id, type.name, type.label, type.description, type.fields)),
    // New types use the id they will be created with.
    ...design.value.plan.types.map((type) =>
      blockSpec(
        stableId('contentType', `${context.spaceId}:${type.name}`),
        type.name,
        type.label ?? type.name,
        type.description,
        type.fields.map((field, index) =>
          normaliseField(type.name, { ...field, admin: field.admin }, index),
        ),
      ),
    ),
  ];

  const spec: AiBlockFieldSpec = {
    name: 'blocks',
    label: 'Blocks',
    single: false,
    types: offered,
    grid: true,
  };
  const known = new Set(offered.map((type) => type.name));
  for (const entry of Array.isArray(answer.blocks) ? answer.blocks : []) {
    const name = (entry as { block?: unknown } | null)?.block;
    if (typeof name === 'string' && !known.has(name)) {
      problems.push(
        `The block "${name}" is neither an existing block type nor one designed under "blockTypes".`,
      );
    }
  }

  const written = blocksFromAnswer(spec, { grid: answer.grid, blocks: answer.blocks });
  if (!written.blocks.length) problems.push('"blocks" must hold at least one block.');

  // Create only new types the layout uses.
  const used = new Set(written.blocks.map((block) => block.type));
  const idOf = (name: string) => stableId('contentType', `${context.spaceId}:${name}`);
  const plan: ContentTypePlan = {
    types: design.value.plan.types.filter((type) => used.has(idOf(type.name))),
  };

  return {
    value: {
      plan,
      title: typeof answer.title === 'string' ? answer.title.trim().slice(0, 200) : '',
      blocks: written.blocks,
      grid: written.grid ?? null,
      newTypes: Object.fromEntries(plan.types.map((type) => [idOf(type.name), type.name])),
      notes: typeof answer.notes === 'string' ? answer.notes.trim().slice(0, 1000) : '',
    },
    problems,
  };
}

function blockSpec(
  id: string,
  name: string,
  label: string,
  description: string | null | undefined,
  fields: ContentTypeDefinition['fields'],
): AiBlockTypeSpec {
  return {
    id,
    name,
    label,
    description: description ?? null,
    fields: fields.filter(isText),
    // Templates leave images to the editor.
    images: [],
    repeaters: repeaterFieldSpecs(fields),
  };
}

const isText = (field: { type: string }): boolean =>
  field.type === 'string' || field.type === 'richtext';

const describeText = (field: { name: string; type: string }): string =>
  `"${field.name}" (${field.type === 'richtext' ? 'simple HTML' : 'plain text'})`;
