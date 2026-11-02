import { type ContentTypeDefinition, delay, parseJsonAnswer, RunError } from '@manablox/core';
import type {
  WorkflowActionContext,
  WorkflowActionDefinition,
  WorkflowFieldSpec,
} from '@manablox/plugin-workflows/define';
import { AI_HOSTED_KINDS, AI_PROVIDERS, AI_STYLE_GROUPS, type AiProviderRef } from '../sdk.js';
import { aiKeys } from './keys.js';
import type { AiDocumentResult } from './services/ai/types.js';
import type { AiService } from './services/ai.service.js';

declare module '@manablox/plugin-workflows/define' {
  /** The field kinds the AI plugin draws in the workflow editor's `workflows:fieldControl`. */
  interface WorkflowFieldKinds {
    /** A provider of the space. */
    aiProvider: true;
    /** A model of the provider in the same action's `provider` field, for its `capability`. */
    aiModel: true;
  }
}

export interface AiConfig extends Record<string, unknown> {
  /** `document` writes every text field of `typeId` at once. */
  capability: 'text' | 'image' | 'document';
  /** A provider kind or `custom:<slug>`; empty uses the space's provider. */
  provider: string;
  model: string;
  prompt: string;
  /** Used when the capability is `document`. */
  typeId: string;
  locale: string;
  /** Style group id -> option id. */
  styles: Record<string, string>;
  /** `json` parses the answer so later rules can test fields. */
  format: 'text' | 'json';
  maxWaitSeconds: number;
}

/** Capabilities that write words and take the text style pickers. */
const WRITTEN = ['text', 'document'];

const styleFields: WorkflowFieldSpec[] = AI_STYLE_GROUPS.map((group) => ({
  name: `styles.${group.id}`,
  label: group.label,
  kind: 'select' as const,
  width: 'half' as const,
  options: [
    { value: '', label: 'No preference' },
    ...group.options.map((option) => ({ value: option.id, label: option.label })),
  ],
  // A single-capability group shows only for that capability.
  ...(group.capabilities.length === 1
    ? {
        showWhen: {
          field: 'capability',
          equals: group.capabilities[0] === 'text' ? WRITTEN : [group.capabilities[0] as string],
        },
      }
    : {}),
}));

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The AI services, which the plugin that registers this action builds. */
function aiOf(ctx: WorkflowActionContext<AiConfig>): AiService {
  const services = ctx.manablox.plugins.get('ai');
  if (!services) throw new Error('The AI plugin has no services yet.');
  return services.ai;
}

/**
 * `ai.generate`: text, a document or a picture from the space's providers; contributed to the
 * workflows plugin, whose types only are imported, so AI works without it.
 */
export const aiGenerateAction: WorkflowActionDefinition<AiConfig> = {
  type: 'ai.generate',
  label: 'Write or draw something',
  description:
    'Asks a model for text, a whole document or a picture. Without a placeholder for an earlier node, the prompt works from what the previous node produced.',
  icon: 'sparkles',
  tone: 'amber',
  group: 'ai',
  groupLabel: 'AI',
  feature: aiKeys.features.workflows,
  inputs: [{ name: 'in', label: 'Anything to write about', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'What was made', type: 'json' },
  outputPaths: [
    { path: 'text', type: 'text', hint: 'The written answer' },
    { path: 'json', type: 'json', hint: 'The answer parsed, when the format is JSON' },
    { path: 'title', type: 'text', hint: 'The title, when a document was written' },
    { path: 'fields', type: 'json', hint: 'Every field of a written document' },
    { path: 'assetId', type: 'asset', hint: 'The picture, when one was drawn' },
  ],
  credential: null,
  fields: [
    {
      name: 'capability',
      label: 'Make',
      kind: 'select',
      width: 'half',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'document', label: 'A whole document' },
        { value: 'image', label: 'A picture' },
      ],
    },
    {
      name: 'provider',
      label: 'Using',
      kind: 'select',
      width: 'half',
      options: [
        { value: '', label: "The space's provider" },
        ...AI_HOSTED_KINDS.map((kind) => ({ value: kind, label: AI_PROVIDERS[kind].label })),
      ],
      hint: "A self-hosted model is used when it is the space's provider for the job.",
    },
    {
      name: 'model',
      label: 'Model',
      kind: 'aiModel',
      hint: 'Empty uses the model the provider is configured with.',
    },
    {
      name: 'typeId',
      label: 'Type of document',
      kind: 'contentType',
      width: 'half',
      hint: 'This node writes it; a Create a document node after it saves it.',
      showWhen: { field: 'capability', equals: ['document'] },
    },
    {
      name: 'locale',
      label: 'Language',
      kind: 'locale',
      width: 'half',
      showWhen: { field: 'capability', equals: ['document'] },
    },
    {
      name: 'prompt',
      label: 'Prompt',
      kind: 'templateArea',
      rows: 8,
      required: true,
      hint: 'Placeholders work here: {{ nodes.crawl.text }}. A prompt without a {{ nodes... }} placeholder is given what the previous node produced.',
    },
    {
      name: 'format',
      label: 'Answer as',
      kind: 'select',
      width: 'half',
      showWhen: { field: 'capability', equals: ['text'] },
      options: [
        { value: 'text', label: 'Text' },
        { value: 'json', label: 'JSON' },
      ],
    },
    {
      name: 'maxWaitSeconds',
      label: 'Wait for a picture at most',
      kind: 'number',
      width: 'half',
      min: 10,
      max: 900,
      showWhen: { field: 'capability', equals: ['image'] },
      hint: 'Seconds.',
    },
    ...styleFields,
  ],
  // Provider setup is per space and checked when the run reaches the node.
  defaults: () => ({
    capability: 'text',
    provider: '',
    model: '',
    prompt: '',
    typeId: '',
    locale: '',
    styles: {},
    format: 'text',
    maxWaitSeconds: 180,
  }),
  validate: (config, at, add) => {
    if (!config.prompt?.trim()) add('plugins.ai.workflow.promptRequired', at('prompt'));
    const capability =
      config.capability === 'image' || config.capability === 'document'
        ? config.capability
        : 'text';
    const typeId = config.typeId?.trim() ?? '';
    if (capability === 'document' && !typeId) {
      add('plugins.workflows.node.content.typeRequired', at('typeId'));
    }
    const styles = Object.fromEntries(
      Object.entries(config.styles ?? {}).filter(([, value]) => value),
    );
    return {
      capability,
      provider: config.provider?.trim() ?? '',
      model: config.model?.trim() ?? '',
      prompt: config.prompt?.trim() ?? '',
      typeId,
      locale: config.locale?.trim() ?? '',
      styles,
      format: config.format === 'json' ? 'json' : 'text',
      maxWaitSeconds: clamp(Math.round(config.maxWaitSeconds ?? 180), 10, 900),
    };
  },
  execute: async (ctx: WorkflowActionContext<AiConfig>) => {
    const ai = aiOf(ctx);

    const rendered = ctx.render(ctx.config.prompt);
    if (!rendered.trim()) {
      throw new RunError('plugins.ai.workflow.promptEmpty', {}, 'The prompt rendered empty');
    }
    const material = materialFor(ctx);
    const prompt = material ? `${rendered}\n\n${MATERIAL_INTRO}\n\n${material}` : rendered;
    const json = ctx.config.capability === 'text' && ctx.config.format === 'json';
    const base = {
      spaceId: ctx.workflow.spaceId,
      // Explicit, since some models answer a passing mention of JSON with prose.
      prompt: json ? `${prompt}\n\n${JSON_ONLY}` : prompt,
      styles: ctx.config.styles,
      ...(ctx.config.provider ? { providerKind: ctx.config.provider as AiProviderRef } : {}),
      ...(ctx.config.model ? { model: ctx.config.model } : {}),
    };

    if (ctx.config.capability === 'image') {
      const started = await ai.startMedia({ ...base, capability: 'image' });
      const finished = await settle(ai, ctx, started, ctx.config.maxWaitSeconds);
      if (finished.status !== 'succeeded') {
        const reason = finished.error ?? `it ended as ${finished.status}`;
        throw new RunError(
          'plugins.ai.workflow.pictureFailed',
          { reason },
          finished.error ?? `The picture ended as ${finished.status}`,
        );
      }
      return {
        kind: 'ok',
        message: 'Drew a picture',
        detail: { generationId: finished.id, assetId: finished.assetId },
        output: { assetId: finished.assetId, generationId: finished.id },
      };
    }

    if (ctx.config.capability === 'document') {
      const type = ctx.manablox.contentTypes.tryGet(ctx.config.typeId);
      if (!type) {
        throw new RunError(
          'plugins.ai.workflow.typeGone',
          {},
          'The type of document to write no longer exists',
        );
      }
      const written = await ai.generateDocument({
        ...base,
        contentTypeId: type.id,
        locale: ctx.config.locale || null,
        // Runs do not draw pictures yet.
        images: false,
      });
      const document = documentValues(type, written);
      return {
        kind: 'ok',
        // The document exists only once a Create a document node saves it.
        message: `Wrote a ${type.label}: "${document.title}" (not saved until a Create a document node saves it)`,
        detail: {
          fields: Object.keys(document.fields),
          ...(material ? { material: material.length } : {}),
        },
        output: {
          ...document,
          typeId: type.id,
          locale: ctx.config.locale || null,
          text: JSON.stringify(written.fields),
        },
      };
    }

    const { text } = await ai.generateText(base);
    const parsed = json ? parseJsonAnswer(text) : null;
    if (json && parsed === null) {
      // The answer usually says what the model was missing.
      throw new RunError(
        'plugins.ai.workflow.notJson',
        { excerpt: excerpt(text) },
        `The model did not answer with JSON: ${excerpt(text)}`,
      );
    }
    return {
      kind: 'ok',
      message: `Wrote ${text.length} characters`,
      detail: {
        characters: text.length,
        preview: text.slice(0, 300),
        ...(material ? { material: material.length } : {}),
      },
      output: { text, json: parsed },
    };
  },
};

const JSON_ONLY = 'Answer with the JSON alone: no explanation, no markdown fence.';
const MATERIAL_INTRO = 'Work from this material, which the previous step of the workflow produced:';
/** Fits a ten-page crawl, below current model limits. */
const MAX_MATERIAL = 60_000;

/** Previous nodes' output as prompt text, unless the prompt already quotes a node. */
function materialFor(ctx: WorkflowActionContext<AiConfig>): string {
  if (/\{\{\s*nodes\./.test(ctx.config.prompt)) return '';
  const parts = Object.values(ctx.inputs)
    .map(asMaterial)
    .filter((part) => part.trim());
  const joined = parts.join('\n\n---\n\n');
  return joined.length > MAX_MATERIAL ? `${joined.slice(0, MAX_MATERIAL)}\n[...]` : joined;
}

/** A node's `text` when it has one, else its JSON. */
function asMaterial(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null || output === undefined) return '';
  const text = (output as { text?: unknown }).text;
  if (typeof text === 'string' && text.trim()) return text;
  return JSON.stringify(output, null, 2);
}

/** The document as a save takes it; the title is also returned alone, as it is a column. */
function documentValues(
  type: ContentTypeDefinition,
  written: Pick<AiDocumentResult, 'fields' | 'blocks' | 'grids' | 'items'>,
): { title: string; fields: Record<string, unknown> } {
  const own = new Map(type.fields.map((field) => [field.name, field]));
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(written.fields)) {
    if (own.has(name)) fields[name] = value;
  }
  for (const [name, blocks] of Object.entries(written.blocks)) {
    const field = own.get(name);
    if (!field) continue;
    const grid = written.grids[name];
    fields[name] =
      field.type === 'block' ? (blocks[0] ?? null) : grid ? { grid, blocks } : { blocks };
  }
  for (const [name, items] of Object.entries(written.items ?? {})) {
    if (own.get(name)?.type === 'repeater') fields[name] = items;
  }
  return { title: written.fields.title?.trim() || 'Untitled', fields };
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 300 ? `"${line.slice(0, 300)}…"` : `"${line}"`;
}

/** Polls a media generation until it settles or the budget runs out. */
async function settle(
  ai: AiService,
  ctx: WorkflowActionContext<AiConfig>,
  started: { id: string; status: string; assetId: string | null; error: string | null },
  maxWaitSeconds: number,
) {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let current = started;
  while (current.status === 'pending' || current.status === 'running') {
    if (Date.now() > deadline) {
      throw new RunError(
        'plugins.ai.workflow.pictureTimeout',
        { seconds: maxWaitSeconds },
        `The picture was not ready after ${maxWaitSeconds}s`,
      );
    }
    await delay(2000, ctx.signal);
    current = await ai.generation(ctx.workflow.spaceId, current.id);
  }
  return current;
}
