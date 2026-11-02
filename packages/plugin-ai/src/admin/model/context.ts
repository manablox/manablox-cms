import type { ContentTypeSummary, FieldContext, FieldContextDocument } from '@manablox/admin-sdk';

/** What the model hears about the document a field sits in. */
export interface AiDocumentContext {
  contentTypeLabel: string | null;
  documentTitle: string | null;
  /** Field label to current text. */
  siblings: Record<string, string> | null;
}

/** The plain text of a rich text value, for model context. */
function richTextToText(value: unknown): string {
  const node = value as { text?: string; content?: unknown[] } | null;
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content
    .map((child) => richTextToText(child))
    .filter(Boolean)
    .join(' ');
}

/** Any text field's value as plain text. */
export function fieldToText(type: string, value: unknown): string {
  if (type === 'richtext') return richTextToText(value);
  return typeof value === 'string' ? value : '';
}

/** The document's text by field label, so a single generated field matches the rest. */
function siblingText(
  type: ContentTypeSummary | null,
  fields: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of type?.fields ?? []) {
    const text = fieldToText(field.type, fields[field.name]);
    if (text.trim()) out[field.label] = text;
  }
  return out;
}

/** The editor's `document` extension as model context; empty outside a document editor. */
export function documentContext(context: FieldContext): AiDocumentContext {
  const document = context.extensions?.document as FieldContextDocument | undefined;
  if (!document) return { contentTypeLabel: null, documentTitle: null, siblings: null };
  return {
    contentTypeLabel: document.type?.label ?? null,
    documentTitle: document.title || null,
    siblings: siblingText(document.type, document.fields),
  };
}
