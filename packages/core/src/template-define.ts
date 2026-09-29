/**
 * Code-declared content templates. `seed` is written once, then belongs to editors;
 * `managed` is rewritten on every sync and read-only in the admin.
 */

import type { SpaceTarget } from './code-resource.js';
import { ManabloxError } from './errors.js';
import { isMachineName } from './ids.js';
import { humanise } from './names.js';
import type { BlocksValue, BlockValue } from './types.js';

export const TEMPLATE_MANAGE_MODES = ['seed', 'managed'] as const;
export type TemplateManageMode = (typeof TEMPLATE_MANAGE_MODES)[number];

/** A block list, with or without the grid it sits on. */
export type TemplateBlocksInput = BlocksValue | BlockValue[];

export interface TemplateDefinitionInput {
  slug: string;
  title?: string | undefined;
  spaces?: SpaceTarget | undefined;
  /** One list for all locales, or one per locale. Unknown locales are skipped. */
  blocks: TemplateBlocksInput | Record<string, TemplateBlocksInput>;
  /** Publish on write; drafts deliver empty. */
  publish?: boolean | undefined;
  manage?: TemplateManageMode | undefined;
  sourceRef?: string;
}

export interface TemplateDefinition {
  kind: 'template';
  slug: string;
  title: string;
  spaces: SpaceTarget;
  /** A `null` locale is the fallback for unnamed locales. */
  blocks: Array<{ locale: string | null; value: BlocksValue }>;
  publish: boolean;
  manage: TemplateManageMode;
  sourceRef?: string;
}

const isBlocksValue = (value: unknown): value is BlocksValue =>
  Boolean(value) && typeof value === 'object' && Array.isArray((value as BlocksValue).blocks);

const asBlocksValue = (value: TemplateBlocksInput): BlocksValue =>
  Array.isArray(value) ? { blocks: value } : value;

export function defineTemplate(input: TemplateDefinitionInput): TemplateDefinition {
  if (!isMachineName(input.slug)) {
    throw ManabloxError.badRequest('codeResource.slug.invalid', {
      kind: 'template',
      slug: input.slug,
    });
  }

  const blocks: TemplateDefinition['blocks'] = [];
  if (Array.isArray(input.blocks) || isBlocksValue(input.blocks)) {
    blocks.push({ locale: null, value: asBlocksValue(input.blocks as TemplateBlocksInput) });
  } else {
    for (const [locale, value] of Object.entries(input.blocks)) {
      blocks.push({ locale, value: asBlocksValue(value) });
    }
  }
  if (blocks.length === 0) {
    throw ManabloxError.badRequest('codeTemplate.blocks.required', { slug: input.slug });
  }

  return {
    kind: 'template',
    slug: input.slug,
    title: input.title ?? humanise(input.slug),
    spaces: input.spaces ?? '*',
    blocks,
    publish: input.publish ?? true,
    manage: input.manage ?? 'seed',
  };
}
