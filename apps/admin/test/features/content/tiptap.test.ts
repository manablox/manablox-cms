import { richTextExtensions as frameExtensions } from '@manablox/live-preview/rich-text';
import { getSchema, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, parseRichTextHtml, richTextExtensions } from '~/features/content/tiptap';

/**
 * The rich text field and the preview frame's inline editor share one schema, so the HTML the
 * frame posts parses back into the document the field stores.
 */

const DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { textAlign: 'center', level: 2 },
      content: [{ type: 'text', text: 'Title' }],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          text: 'a link',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
                title: null,
              },
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [{ type: 'text', text: 'Quoted', marks: [{ type: 'strike' }] }],
        },
      ],
    },
  ],
};

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the rich text schema', () => {
  it('is the one the preview frame edits with', () => {
    expect(richTextExtensions).toBe(frameExtensions);
    const marks = Object.keys(getSchema(richTextExtensions()).marks);
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'strike', 'link']));
  });

  it('parses the HTML an editor with it produces back into the same document', () => {
    editor = new Editor({ extensions: frameExtensions(), content: DOC });
    expect(editor.getJSON()).toEqual(DOC);
    expect(parseRichTextHtml(editor.getHTML())).toEqual(DOC);
  });
});
