import type { FieldDefinition } from '@manablox/core';
import { parseJsonObject } from '@manablox/core';
import type { AiCapability, AiLengthTarget } from '../sdk.js';
import { stylePhrases } from '../sdk.js';

/** Where a generation was requested from, so the model writes for the target field. */
export interface AiRequestContext {
  contentTypeLabel?: string | null | undefined;
  fieldLabel?: string | null | undefined;
  /** E.g. `string`, `richtext`, `asset`. */
  fieldType?: string | null | undefined;
  locale?: string | null | undefined;
  /** Title and sibling values, for consistency. */
  documentTitle?: string | null | undefined;
  siblings?: Record<string, string> | null | undefined;
  maxLength?: number | null | undefined;
}

/** The configured system prompt, or the default. */
export function systemPromptFor(configured: string, fallback: string): string {
  return configured.trim() || fallback;
}

/** The text prompt: context, styles, length, then the editor's instruction last so it wins. */
export function composeTextPrompt(
  instruction: string,
  styles: Record<string, string | undefined> | null | undefined,
  context: AiRequestContext,
  length?: AiLengthTarget | null,
): string {
  const parts: string[] = [];

  if (context.contentTypeLabel) {
    parts.push(`This is for a "${context.contentTypeLabel}" document in a CMS.`);
  }
  if (context.fieldLabel) {
    const shape =
      context.fieldType === 'richtext'
        ? 'a rich text field - reply with simple HTML (p, h2, h3, ul, ol, li, strong, em, a) and nothing else'
        : 'a plain text field - reply with unformatted text on a single line unless the request asks otherwise';
    parts.push(`Write the "${context.fieldLabel}" field. It is ${shape}.`);
  }
  if (context.maxLength) parts.push(`Stay under ${context.maxLength} characters.`);
  if (context.locale) parts.push(`Write in the locale "${context.locale}".`);
  if (context.documentTitle) parts.push(`The document is titled "${context.documentTitle}".`);

  const siblings = Object.entries(context.siblings ?? {}).filter(([, value]) => value.trim());
  if (siblings.length) {
    parts.push(
      [
        'What the document already says, for consistency:',
        ...siblings.map(([name, value]) => `- ${name}: ${truncate(value, 500)}`),
      ].join('\n'),
    );
  }

  parts.push(...stylePhrases('text', styles));
  // A field's maxLength wins over a length preset.
  const phrase = fieldLengthPhrase(length, context.maxLength);
  if (phrase) parts.push(phrase);
  parts.push(`The request: ${instruction}`);
  return parts.join('\n\n');
}

/** A field's target word count with a tolerance band; models follow numbers better than adjectives. */
export function fieldLengthPhrase(
  length: AiLengthTarget | null | undefined,
  maxLength?: number | null,
): string {
  const words = length?.words;
  if (!words) return '';
  if (maxLength && words * 6 > maxLength) return '';
  return `Write about ${words} words - no fewer than ${Math.round(words * 0.8)} and no more than ${Math.round(words * 1.2)}.`;
}

/** A document's target word count, weighted towards the body. */
export function documentLengthPhrase(length: AiLengthTarget | null | undefined): string {
  const words = length?.words;
  if (!words) return '';
  return [
    `The document runs to about ${words} words in total - at least ${Math.round(words * 0.85)}.`,
    'Spread them by purpose: a title stays a title and a teaser a sentence or two, while the body - its rich text fields and its blocks - carries the rest, in as many paragraphs and sections as that takes.',
    'A document shorter than asked is a failed answer; so is padding. Fill the length with substance: explanation, examples, detail, steps.',
  ].join(' ');
}

/** The image or video prompt: subject first, then styling. */
export function composeMediaPrompt(
  capability: Extract<AiCapability, 'image' | 'video'>,
  instruction: string,
  styles: Record<string, string | undefined> | null | undefined,
  context: AiRequestContext,
): string {
  const parts = [instruction.trim()];
  parts.push(...stylePhrases(capability, styles));
  if (context.documentTitle) parts.push(`It illustrates: ${context.documentTitle}.`);
  return parts.filter(Boolean).join(' ');
}

/** An asset field the model writes an image brief for. */
export interface AiImageFieldSpec {
  name: string;
  label: string;
}

/** A block type offered to the model. */
export interface AiBlockTypeSpec {
  /** Content type id; not shown to the model. */
  id: string;
  /** Machine name the model answers with. */
  name: string;
  label: string;
  description?: string | null | undefined;
  /** Text fields the model fills in. */
  fields: FieldDefinition[];
  /** Asset fields the model writes image briefs for. */
  images: AiImageFieldSpec[];
  /** Repeater fields the model writes items for. */
  repeaters?: AiRepeaterFieldSpec[] | undefined;
}

/** A repeater field: a list of items, each with the same text sub-fields. */
export interface AiRepeaterFieldSpec {
  name: string;
  label: string;
  min?: number | undefined;
  max?: number | undefined;
  /** Text sub-fields the model fills in per item. */
  fields: FieldDefinition[];
}

/** A block field on the document. */
export interface AiBlockFieldSpec {
  name: string;
  label: string;
  /** True for a `block` field, false for `blocks`. */
  single: boolean;
  min?: number | undefined;
  max?: number | undefined;
  types: AiBlockTypeSpec[];
  /** Whether to ask for a grid and per-block placement. */
  grid: boolean;
}

/** `- "name": Label (plain text, required, under 60 characters)` */
function describeField(field: FieldDefinition): string {
  const kind = field.type === 'richtext' ? 'simple HTML' : 'plain text';
  const settings = field.settings as { max?: number; maxLength?: number };
  const max = settings.max ?? settings.maxLength;
  const limits = [kind, field.required ? 'required' : null, max ? `under ${max} characters` : null]
    .filter(Boolean)
    .join(', ');
  return `- "${field.name}": ${field.label} (${limits})`;
}

/** `- picture "image": Image - say what should be in it` */
function describeImageField(field: AiImageFieldSpec): string {
  return `- picture "${field.name}": ${field.label} - describe what should be in it`;
}

/** `- list "quotes": Quotes - as many items as it needs, each with:` and the sub-fields. */
function describeRepeaterField(spec: AiRepeaterFieldSpec, indent = ''): string {
  const count = [
    'as many items as it needs',
    spec.min ? `, at least ${spec.min}` : '',
    spec.max ? `, at most ${spec.max}` : '',
  ].join('');
  return [
    `${indent}- list "${spec.name}": ${spec.label} - ${count}, each with:`,
    ...spec.fields.map((field) => `${indent}    ${describeField(field)}`),
  ].join('\n');
}

/** Grid layout instructions; the model picks both columns and placements. */
function describeGrid(spec: AiBlockFieldSpec): string {
  return [
    `Lay "${spec.name}" out on a grid, and choose the grid to suit what you wrote.`,
    'Give it a number of columns from 1 to 12 - 2, 3 or 4 read well on a page - and place every block on it with "layout": {"column": <first column, from 1>, "row": <first row, from 1>, "columnSpan": <columns it covers>, "rowSpan": <rows it covers>}.',
    'A block carrying a lot of text should be wider than one carrying a line; two or three short blocks side by side read better than the same blocks stacked; and a block that opens or closes the page usually spans the full width.',
    'Every block must sit inside the grid and no two may overlap. Answer the grid as "grid": {"columns": N} beside the blocks.',
  ].join(' ');
}

/** Describes a block field: the types on offer and how many to write. */
function describeBlockField(spec: AiBlockFieldSpec, target?: number): string {
  const types = spec.types.map((type) => {
    const lines = [
      ...type.fields.map((field) => `    ${describeField(field)}`),
      ...type.images.map((field) => `    ${describeImageField(field)}`),
      ...(type.repeaters ?? []).map((spec) => describeRepeaterField(spec, '    ')),
    ].join('\n');
    const about = type.description ? ` - ${type.description}` : '';
    return `  - "${type.name}" (${type.label})${about}${lines ? `\n${lines}` : ' - nothing to fill in'}`;
  });

  const howMany = spec.single
    ? 'Write exactly one block for it.'
    : [
        'Write as many blocks as the piece needs, in the order they should be read',
        spec.min ? `, at least ${spec.min}` : '',
        spec.max ? `, at most ${spec.max}` : '',
        target ? ` - aim for ${boundedBlocks(target, spec)} of them` : '',
        '. Choose the block types that suit what is being said; a type may be used more than once, and one that does not fit should be left out.',
      ].join('');

  return [
    `"${spec.name}" (${spec.label}) is a sequence of blocks that makes up the body of the document. ${howMany}`,
    'The blocks available, each with the fields to fill in:',
    types.join('\n'),
    spec.grid ? describeGrid(spec) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Clamps a block count to the field's min and max. */
export function boundedBlocks(target: number, spec: Pick<AiBlockFieldSpec, 'min' | 'max'>): number {
  let count = Math.max(1, Math.round(target));
  if (spec.min !== undefined) count = Math.max(count, spec.min);
  if (spec.max !== undefined) count = Math.min(count, spec.max);
  return count;
}

/** Input for a whole-document prompt, answered as one JSON object so the fields stay consistent. */
export interface AiDocumentPromptInput {
  instruction: string;
  styles?: Record<string, string | undefined> | null | undefined;
  typeLabel: string;
  fields: FieldDefinition[];
  locale?: string | null | undefined;
  blockFields?: AiBlockFieldSpec[];
  /** Document-level asset fields to write image briefs for. */
  images?: AiImageFieldSpec[];
  /** Document-level repeater fields to write items for. */
  repeaters?: AiRepeaterFieldSpec[];
  /** Allowed image aspect ratios. */
  aspectRatios?: readonly string[];
  /** Words for the document, blocks per block field. */
  length?: AiLengthTarget | null | undefined;
  /** Target audience. */
  audience?: string | null | undefined;
  /** Terms to use. */
  keywords?: readonly string[] | null | undefined;
}

export function composeDocumentPrompt(input: AiDocumentPromptInput): string {
  const { instruction, styles, typeLabel, fields, locale } = input;
  const blockFields = input.blockFields ?? [];
  const images = input.images ?? [];
  const repeaters = input.repeaters ?? [];
  const wantsLists =
    repeaters.length > 0 ||
    blockFields.some((spec) => spec.types.some((type) => type.repeaters?.length));
  const wantsPictures =
    images.length > 0 || blockFields.some((spec) => spec.types.some((type) => type.images.length));

  const answerShape = [
    'Answer with a single JSON object: the field names above as keys, the written value of each as a string.',
    'A rich text field takes simple HTML (p, h2, h3, ul, ol, li, strong, em, a) inside the string.',
    blockFields.length
      ? `A block field takes an object {"grid": {"columns": N}, "blocks": [...]}: ${blockFields
          .map((spec) => `"${spec.name}"`)
          .join(
            ', ',
          )} - each block an object {"block": "<one of the names above>", "fields": {<that block's own fields>}, "layout": {...}}.`
      : '',
    wantsLists
      ? 'A list takes an array of items, each an object of its own fields: [{"<field>": "<value>", ...}, ...].'
      : '',
    wantsPictures
      ? `A picture is answered as {"prompt": "<what is in the picture>", "aspect": "<one of ${(input.aspectRatios ?? []).join(', ')}>"}, under "images" keyed by the picture's name - on the document for the document's own pictures, and inside a block for that block's.`
      : '',
    'No markdown fence, no commentary, no other keys.',
  ].filter(Boolean);

  return [
    `Write a complete "${typeLabel}" document for a CMS.`,
    locale ? `Write in the locale "${locale}".` : '',
    'Fill in every field below. The fields belong to one document, so they must agree with each other.',
    [
      ...fields.map(describeField),
      ...images.map(describeImageField),
      ...repeaters.map((spec) => describeRepeaterField(spec)),
    ].join('\n'),
    ...blockFields.map((spec) => describeBlockField(spec, input.length?.blocks)),
    wantsPictures
      ? 'A picture is described, not drawn: say what belongs in it - the subject, the setting, what is happening - in a sentence or two, as an instruction to an image model. It has to suit the text beside it. Never describe a picture that contains words, a logo, or a real person.'
      : '',
    ...stylePhrases('text', styles),
    documentLengthPhrase(input.length),
    input.audience?.trim() ? `Write for this audience: ${input.audience.trim()}.` : '',
    input.keywords?.length
      ? `Use these terms naturally where they fit, the first ones most: ${input.keywords.join(', ')}.`
      : '',
    answerShape.join(' '),
    `The request: ${instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The text-valued entries of an answer. */
export function parseFieldMap(answer: string): Record<string, string> | null {
  const parsed = parseJsonObject(answer);
  return parsed && textValues(parsed);
}

/** String values, with numbers and booleans stringified. */
export function textValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
