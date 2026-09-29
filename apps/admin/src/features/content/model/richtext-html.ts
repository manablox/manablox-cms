/** Converts `contenteditable` HTML to the rich text field's ProseMirror JSON; the parser loads on first use. */
export async function htmlToRichText(html: string): Promise<Record<string, unknown>> {
  const trimmed = html.trim();
  if (!trimmed) return { type: 'doc', content: [] };
  const { parseRichTextHtml } = await import('~/features/content/tiptap');
  return parseRichTextHtml(trimmed);
}
