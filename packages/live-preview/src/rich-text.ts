import type { Extensions } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';

/**
 * The rich text schema. The admin's rich text field and the frame's inline editor both build
 * their editor from this list, so both accept and store the same documents. Links do not
 * open on click while editing.
 */
export function richTextExtensions(): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ];
}
