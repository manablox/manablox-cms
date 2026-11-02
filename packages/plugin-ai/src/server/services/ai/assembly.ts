import {
  type BlockGridValue,
  type BlockValue,
  type ContentTypeDefinition,
  type ContentTypeRegistry,
  type FieldDefinition,
  type FieldItem,
  ManabloxError,
} from '@manablox/core';
import { type AiCapability, type AiLengthTarget, styleValue } from '../../../sdk.js';
import {
  blockFieldSpecs,
  blocksFromAnswer,
  IMAGE_RATIOS,
  imageFieldSpecs,
  itemsFromAnswer,
  readImages,
  repeaterFieldSpecs,
  writableTextFields,
} from '../../document-plan.js';
import {
  type AiBlockFieldSpec,
  type AiImageFieldSpec,
  type AiRepeaterFieldSpec,
  type AiRequestContext,
  composeDocumentPrompt,
  composeMediaPrompt,
  textValues,
} from '../../prompt.js';
import type { ProviderCall } from '../../providers/index.js';
import type { AiDocumentImage, AiDocumentInput } from './types.js';

/** What a document generation asks the model to write. */
export interface DocumentPlan {
  type: ContentTypeDefinition;
  fields: FieldDefinition[];
  blockFields: AiBlockFieldSpec[];
  repeaters: AiRepeaterFieldSpec[];
  /** Document-level image briefs; empty when images are off. */
  images: AiImageFieldSpec[];
}

/** The writable fields of the type, narrowed to the requested block types and image choice. */
export function planDocument(
  type: ContentTypeDefinition,
  registry: ContentTypeRegistry,
  input: Pick<AiDocumentInput, 'blockTypes' | 'images'>,
): DocumentPlan {
  const pictures = input.images !== false;
  const allowed = new Set(input.blockTypes ?? []);
  const fields = writableTextFields(type);
  const blockFields = blockFieldSpecs(type, registry)
    .map((spec) => ({
      ...spec,
      types: narrowed(spec.types, allowed).map((entry) =>
        pictures ? entry : { ...entry, images: [] },
      ),
    }))
    .filter((spec) => spec.types.length);
  const images = pictures ? imageFieldSpecs(type.fields) : [];
  const repeaters = repeaterFieldSpecs(type.fields);
  if (!fields.length && !blockFields.length) {
    throw ManabloxError.badRequest('plugins.ai.document.type.noTextFields');
  }
  return { type, fields, blockFields, repeaters, images };
}

export function documentPrompt(
  plan: DocumentPlan,
  instruction: string,
  input: Pick<AiDocumentInput, 'styles' | 'locale' | 'audience' | 'keywords'>,
  length: AiLengthTarget | null | undefined,
): string {
  return composeDocumentPrompt({
    instruction,
    styles: input.styles,
    typeLabel: plan.type.label,
    fields: plan.fields,
    locale: input.locale,
    blockFields: plan.blockFields,
    repeaters: plan.repeaters,
    images: plan.images,
    aspectRatios: IMAGE_RATIOS,
    length,
    audience: input.audience,
    keywords: input.keywords,
  });
}

export interface DocumentAnswer {
  fields: Record<string, string>;
  blocks: Record<string, BlockValue[]>;
  grids: Record<string, BlockGridValue>;
  items: Record<string, FieldItem[]>;
  images: AiDocumentImage[];
}

/** The planned fields, blocks, repeater items and image briefs out of a parsed answer; unasked keys are dropped. */
export function readDocumentAnswer(
  parsed: Record<string, unknown>,
  plan: DocumentPlan,
): DocumentAnswer {
  const wanted = new Set(plan.fields.map((field) => field.name));
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(textValues(parsed))) {
    if (wanted.has(name)) fields[name] = value;
  }

  const blocks: Record<string, BlockValue[]> = {};
  const grids: Record<string, BlockGridValue> = {};
  const images: AiDocumentImage[] = [];

  // Document-level images come before block images.
  for (const picture of readImages(parsed.images, plan.images)) {
    images.push({ ...picture, field: picture.name });
  }

  for (const spec of plan.blockFields) {
    const written = blocksFromAnswer(spec, parsed[spec.name]);
    if (!written.blocks.length) continue;
    blocks[spec.name] = written.blocks;
    if (written.grid) grids[spec.name] = written.grid;
    images.push(...written.images);
  }

  const items: Record<string, FieldItem[]> = {};
  for (const spec of plan.repeaters) {
    const written = itemsFromAnswer(spec, parsed[spec.name]);
    if (written.length) items[spec.name] = written;
  }

  return { fields, blocks, grids, items, images };
}

/** Prompt and capability options for a stored media generation. */
export function mediaCall(
  capability: Extract<AiCapability, 'image' | 'video'>,
  prompt: string,
  styles: Record<string, string>,
  context: AiRequestContext,
): Pick<ProviderCall, 'prompt' | 'options'> {
  return {
    prompt: composeMediaPrompt(capability, prompt, styles, context),
    options:
      capability === 'video'
        ? {
            aspectRatio: styleValue('videoAspectRatio', styles, '16:9'),
            duration: styleValue('duration', styles, '8'),
          }
        : {
            aspectRatio: styleValue('aspectRatio', styles, '1:1'),
            // Only the Nano Banana models take a size; the Imagen call drops it.
            resolution: styleValue('resolution', styles, ''),
          },
  };
}

/** The instruction again, with the rejected answer and what to fix. */
export function retryPrompt(instruction: string, answer: string, problems: string[]): string {
  return [
    instruction,
    'Your previous answer was:',
    answer.slice(0, 30_000),
    'It has these problems. Answer again with the whole corrected JSON object, fixing every one:',
    ...problems.map((problem) => `- ${problem}`),
  ].join('\n\n');
}

/** History label for a design request: the purpose and the request's last paragraph. */
export function designLabel(purpose: string, instruction: string): string {
  const parts = instruction.split(/\n{2,}/);
  const request = (parts[parts.length - 1] ?? instruction).replace(/^The request:\s*/i, '').trim();
  return `${purpose}: ${request}`.slice(0, 4000);
}

export function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw ManabloxError.badRequest('plugins.ai.prompt.required');
  return trimmed;
}

/** Narrows block types to the allowed set, keeping all if none match. */
function narrowed<T extends { id: string }>(types: T[], allowed: Set<string>): T[] {
  if (!allowed.size) return types;
  const kept = types.filter((type) => allowed.has(type.id));
  return kept.length ? kept : types;
}
