import { ManabloxError, RunError, type Scope } from '@manablox/core';
import {
  defineWorkflowAction,
  type WorkflowActionContext,
  type WorkflowValidateAdd,
  type WorkflowValidatePath,
} from '../../define/action.js';
import { lonePath } from '../template.js';
import { keyValueRows, looksLikeJson } from './shared.js';

export interface ContentConfig extends Record<string, unknown> {
  typeId: string;
  locale: string;
  /** A placeholder for a document an earlier node wrote; title and fields set here override it. */
  from: string;
  title: string;
  slug: string;
  /** Field technical name -> a template. A JSON template keeps its types. */
  fields: Array<{ name: string; value: string }>;
  parentId: string;
  publish: boolean;
}

export interface ContentUpdateConfig extends ContentConfig {
  /** A template resolving to a document id; empty means the triggering document. */
  contentId: string;
}

const fieldSpecs = [
  {
    name: 'from',
    label: 'Take everything from',
    kind: 'template' as const,
    placeholder: '{{ nodes.write }}',
    hint: 'A document an AI node wrote. Its type, title and fields are used unless set below.',
  },
  { name: 'typeId', label: 'Type', kind: 'contentType' as const },
  { name: 'locale', label: 'Language', kind: 'locale' as const, width: 'half' as const },
  {
    name: 'parentId',
    label: 'Under',
    kind: 'template' as const,
    width: 'half' as const,
    hint: 'A document id, or empty for the top level.',
  },
  {
    name: 'title',
    label: 'Title',
    kind: 'template' as const,
    hint: 'Empty takes the title of the document it is taken from.',
  },
  {
    name: 'slug',
    label: 'Slug',
    kind: 'template' as const,
    hint: 'Empty derives one from the title.',
  },
  {
    name: 'fields',
    label: 'Fields',
    kind: 'keyValue' as const,
    hint: 'The field’s technical name on the left, a template on the right.',
  },
  { name: 'publish', label: 'Publish it straight away', kind: 'switch' as const },
];

/** A document as the AI node outputs it. */
interface SourceDocument {
  typeId?: unknown;
  locale?: unknown;
  title?: unknown;
  fields?: unknown;
}

/** The document `from` points at, if any. */
function sourceOf(ctx: WorkflowActionContext<ContentConfig>): SourceDocument {
  const from = ctx.config.from.trim();
  if (!from) return {};
  // A lone placeholder yields the value itself, not its text.
  const path = lonePath(from) ?? from;
  const value = ctx.resolve(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RunError(
      'plugins.workflows.run.notADocument',
      { from },
      `"${from}" is not a document an earlier node wrote`,
    );
  }
  return value as SourceDocument;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The workflow's space environment; its space alone when the context names none. */
function workflowScope(ctx: WorkflowActionContext): Scope {
  const { spaceId, environmentId } = ctx.workflow;
  return environmentId ? { spaceId, environmentId } : spaceId;
}

/** Save input, merged from the source document and this node's settings. */
function saveInput(ctx: WorkflowActionContext<ContentConfig>) {
  const source = sourceOf(ctx);
  const typeId = ctx.config.typeId || text(source.typeId);
  if (!typeId) throw ManabloxError.badRequest('plugins.workflows.node.content.typeRequired');
  const locale = ctx.config.locale || text(source.locale);
  const sourceFields =
    source.fields && typeof source.fields === 'object'
      ? (source.fields as Record<string, unknown>)
      : {};
  return {
    spaceId: ctx.workflow.spaceId,
    ...(ctx.workflow.environmentId ? { environmentId: ctx.workflow.environmentId } : {}),
    typeId,
    title: ctx.render(ctx.config.title).trim() || text(source.title).trim() || 'Untitled',
    fields: { ...sourceFields, ...fieldValues(ctx) },
    ...(locale ? { locale } : {}),
    ...(ctx.config.slug ? { slug: ctx.render(ctx.config.slug) } : {}),
  };
}

function fieldValues(ctx: WorkflowActionContext<ContentConfig>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ctx.config.fields) {
    const name = field.name.trim();
    if (!name) continue;
    // JSON templates render as JSON so structured fields are not flattened to strings.
    out[name] = looksLikeJson(field.value)
      ? JSON.parse(ctx.renderJson(field.value))
      : ctx.render(field.value);
  }
  return out;
}

function requireContent(ctx: WorkflowActionContext<ContentConfig>) {
  const content = ctx.services.content;
  if (!content)
    throw ManabloxError.badRequest('plugins.workflows.action.unavailable', { type: 'content' });
  return content;
}

const baseDefaults = (): ContentConfig => ({
  typeId: '',
  locale: '',
  from: '',
  title: '{{ nodes.write.json.title }}',
  slug: '',
  fields: [],
  parentId: '',
  publish: false,
});

const validateBase = (
  config: ContentConfig,
  at: WorkflowValidatePath,
  add: WorkflowValidateAdd,
): ContentConfig => {
  const from = config.from?.trim() ?? '';
  // A document taken from an earlier node brings its own type.
  if (!config.typeId?.trim() && !from)
    add('plugins.workflows.node.content.typeRequired', at('typeId'));
  return {
    typeId: config.typeId?.trim() ?? '',
    locale: config.locale?.trim() ?? '',
    from,
    title: config.title ?? '',
    slug: config.slug?.trim() ?? '',
    fields: keyValueRows(config.fields).filter((field) => field.name.trim()),
    parentId: config.parentId?.trim() ?? '',
    publish: Boolean(config.publish),
  };
};

export const contentCreateAction = defineWorkflowAction<ContentConfig>({
  type: 'content.create',
  label: 'Create a document',
  description: 'Writes a new document from what an earlier node produced.',
  icon: 'file-plus',
  tone: 'cyan',
  group: 'content',
  inputs: [{ name: 'in', label: 'What to write', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'The document', type: 'document' },
  outputPaths: [
    { path: 'id', type: 'text', hint: 'The new document' },
    { path: 'title', type: 'text', hint: '' },
    { path: 'status', type: 'text', hint: 'draft or published' },
  ],
  credential: null,
  fields: fieldSpecs,
  defaults: baseDefaults,
  validate: validateBase,
  execute: async (ctx: WorkflowActionContext<ContentConfig>) => {
    const content = requireContent(ctx);
    const row = await content.create({
      ...saveInput(ctx),
      ...(ctx.config.parentId ? { parentId: ctx.render(ctx.config.parentId) } : {}),
    });
    const saved = ctx.config.publish ? await content.publish(workflowScope(ctx), row.id) : row;
    return {
      kind: 'ok',
      message: `Created "${saved.title}"`,
      detail: { id: saved.id, status: saved.status },
      output: saved,
    };
  },
});

export const contentUpdateAction = defineWorkflowAction<ContentUpdateConfig>({
  type: 'content.update',
  label: 'Update a document',
  description: 'Writes new values onto an existing document.',
  icon: 'file-pen',
  tone: 'cyan',
  group: 'content',
  inputs: [{ name: 'in', label: 'What to write', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'The document', type: 'document' },
  outputPaths: [
    { path: 'id', type: 'text', hint: 'The document' },
    { path: 'title', type: 'text', hint: '' },
    { path: 'status', type: 'text', hint: 'draft or published' },
  ],
  credential: null,
  fields: [
    {
      name: 'contentId',
      label: 'Document',
      kind: 'template',
      hint: 'A document id. Empty means the document that started this run.',
    },
    ...fieldSpecs.filter((field) => field.name !== 'parentId'),
  ],
  defaults: () => ({ ...baseDefaults(), contentId: '', title: '{{ content.title }}' }),
  validate: (config, at, add) => ({
    ...validateBase(config, at, add),
    contentId: config.contentId?.trim() ?? '',
  }),
  execute: async (ctx: WorkflowActionContext<ContentUpdateConfig>) => {
    const content = requireContent(ctx);
    const id = ctx.config.contentId
      ? ctx.render(ctx.config.contentId).trim()
      : ((ctx.run.content?.id as string | undefined) ?? '');
    if (!id) throw new ManabloxError('plugins.workflows.node.content.idRequired');

    const row = await content.update(workflowScope(ctx), id, saveInput(ctx));
    const saved = ctx.config.publish ? await content.publish(workflowScope(ctx), row.id) : row;
    return {
      kind: 'ok',
      message: `Updated "${saved.title}"`,
      detail: { id: saved.id, status: saved.status },
      output: saved,
    };
  },
});
