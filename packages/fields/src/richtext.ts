import { defineFieldType } from '@manablox/core';
import { z } from 'zod';
import { htmlToRichTextDoc } from './richtext-html.js';

/** A Tiptap/ProseMirror document node. */
export type RichTextNode = {
  type: string;
  // `| undefined` for `exactOptionalPropertyTypes`, matching Zod's `.optional()`.
  attrs?: Record<string, unknown> | undefined;
  content?: RichTextNode[] | undefined;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> | undefined }> | undefined;
  text?: string | undefined;
};

const richTextNode: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richTextNode).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() }))
      .optional(),
    text: z.string().optional(),
  }),
);

export const richTextSettings = z.object({
  /** Marks and nodes the editor offers. */
  toolbar: z
    .array(
      z.enum([
        'bold',
        'italic',
        'strike',
        'code',
        'link',
        'heading',
        'bulletList',
        'orderedList',
        'blockquote',
        'codeBlock',
        'horizontalRule',
        'alignLeft',
        'alignCenter',
        'alignRight',
        'image',
        'table',
      ]),
    )
    .default(['bold', 'italic', 'link', 'heading', 'bulletList', 'orderedList']),
  maxLength: z.number().int().positive().optional(),
});

export type RichTextSettings = z.infer<typeof richTextSettings>;
export type RichTextTool = RichTextSettings['toolbar'][number];

/** All tools, in toolbar order. */
export const RICH_TEXT_TOOLS: { value: RichTextTool; label: string }[] = [
  { value: 'bold', label: 'Bold' },
  { value: 'italic', label: 'Italic' },
  { value: 'strike', label: 'Strikethrough' },
  { value: 'code', label: 'Code' },
  { value: 'link', label: 'Link' },
  { value: 'heading', label: 'Heading' },
  { value: 'bulletList', label: 'Bulleted list' },
  { value: 'orderedList', label: 'Numbered list' },
  { value: 'blockquote', label: 'Quote' },
  { value: 'codeBlock', label: 'Code block' },
  { value: 'horizontalRule', label: 'Divider' },
  { value: 'alignLeft', label: 'Align left' },
  { value: 'alignCenter', label: 'Align centre' },
  { value: 'alignRight', label: 'Align right' },
];

/** Rich text as a Tiptap JSON document. */
export const richTextField = defineFieldType<RichTextSettings, RichTextNode>({
  name: 'richtext',
  label: 'Rich text',
  icon: 'i-lucide-text-quote',

  settingsSchema: richTextSettings,
  // Strings are parsed as HTML or prose, for clients without the editor.
  valueSchema: () =>
    z.preprocess(
      (value) => (typeof value === 'string' ? htmlToRichTextDoc(value) : value),
      richTextNode,
    ),
  defaultValue: () => ({ type: 'doc', content: [] }),
  isEmpty: (value) => isEmptyRichText(value),

  // Searched, not filtered, so no index.
  storage: { kind: 'jsonb', index: false },
  filters: ['isNull', 'isNotNull'],
  graphql: { type: { kind: 'scalar', name: 'JSON' } },
  search: (value) => plainText(value) || null,

  admin: { input: 'richtext', settings: 'richtext', summary: true },
});

/** Nodes that are content without holding text. */
const CONTENT_ATOMS = new Set(['image', 'horizontalRule']);

/** Whether a document holds no text and no image or divider. HTML strings are checked as text. */
export function isEmptyRichText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const { type, text, content } = node as RichTextNode;
    if ((typeof text === 'string' && text.trim()) || CONTENT_ATOMS.has(type)) return false;
    return Array.isArray(content) ? content.every(walk) : true;
  };
  return walk(value);
}

/** Flattens a ProseMirror document to its text content. */
export function plainText(node: RichTextNode | null | undefined): string {
  if (!node) return '';
  const parts: string[] = [];
  const walk = (current: RichTextNode) => {
    if (current.text) parts.push(current.text);
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts.join(' ').trim();
}
