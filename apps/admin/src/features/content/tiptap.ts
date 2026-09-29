import { richTextExtensions } from '@manablox/live-preview/rich-text';
import { generateJSON } from '@tiptap/core';

export { Editor, EditorContent } from '@tiptap/vue-3';
/** The rich text schema, shared with the preview frame's inline editor. */
export { richTextExtensions };

/** Parses `contenteditable` HTML into the rich text field's ProseMirror JSON. */
export function parseRichTextHtml(html: string): Record<string, unknown> {
  // Bare text still needs a block.
  const wrapped = /^\s*<(p|h[1-6]|ul|ol|blockquote|pre|div)\b/i.test(html)
    ? html
    : `<p>${html}</p>`;
  return generateJSON(wrapped, richTextExtensions());
}
