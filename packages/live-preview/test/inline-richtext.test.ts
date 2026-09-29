import { richTextToHtml } from '@manablox/public-sdk';
import { type Editor, generateJSON, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRichTextEditor, type RichTextEditor } from '../src/inline-richtext.js';
import { richTextExtensions } from '../src/rich-text.js';

/** The frame's rich text editor: toolbar commands and the documents it exchanges with the admin. */

/** How the admin turns the posted HTML back into the stored document (`parseRichTextHtml`). */
const adminParse = (html: string) => generateJSON(html, richTextExtensions());

const text = (value: string, marks?: JSONContent['marks']): JSONContent =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  attrs: { textAlign: null },
  content,
});

/** A document using every node and mark of the schema, as the admin's editor stores it. */
const FULL: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { textAlign: 'center', level: 2 }, content: [text('Title')] },
    paragraph(
      text('Plain, '),
      text('bold', [{ type: 'bold' }]),
      text(', '),
      text('italic', [{ type: 'italic' }]),
      text(', '),
      text('struck', [{ type: 'strike' }]),
      text(', '),
      text('under', [{ type: 'underline' }]),
      text(', '),
      text('code', [{ type: 'code' }]),
      text(' and a '),
      text('link', [
        {
          type: 'link',
          attrs: {
            href: 'https://example.com',
            target: '_blank',
            rel: 'noopener',
            class: null,
            title: null,
          },
        },
      ]),
      { type: 'hardBreak' },
      text('after a break'),
    ),
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(text('One'))] }],
    },
    {
      type: 'orderedList',
      attrs: { start: 3, type: null },
      content: [{ type: 'listItem', content: [paragraph(text('Three'))] }],
    },
    { type: 'blockquote', content: [paragraph(text('Quoted'))] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      attrs: { textAlign: 'right' },
      content: [text('Right')],
    },
  ],
};

let editors: RichTextEditor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.innerHTML = '';
});

function mount(content: JSONContent | string, fallback = '') {
  const element = document.createElement('div');
  element.className = 'prose';
  element.setAttribute('data-manablox-field', 'body');
  element.innerHTML = fallback;
  document.body.appendChild(element);
  const changes: number[] = [];
  const editor = createRichTextEditor(element, {
    content,
    fallback,
    onChange: () => changes.push(1),
    onSelection: () => {},
  });
  editors.push(editor);
  return { element, editor, changes };
}

/** Selects the text `needle`, through the Tiptap editor the element carries. */
function select(element: HTMLElement, needle: string) {
  const tiptap = (element as HTMLElement & { editor: Editor }).editor;
  let from = -1;
  tiptap.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? '').indexOf(needle) : -1;
    if (from === -1 && at >= 0) from = pos + at;
  });
  if (from === -1) throw new Error(`"${needle}" not found`);
  tiptap.commands.setTextSelection({ from, to: from + needle.length });
}

describe('the round trip with the admin', () => {
  it('holds a stored document exactly as the admin stores it', () => {
    const { editor } = mount(FULL);
    expect(editor.json()).toEqual(FULL);
    expect(editor.changed()).toBe(false);
  });

  it('posts HTML the admin parses back into the same document', () => {
    const { editor } = mount(FULL);
    expect(adminParse(editor.html())).toEqual(editor.json());
  });

  it('reads what a frontend renders with richTextToHtml when there is no stored document', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { textAlign: null, level: 3 }, content: [text('Hi')] },
        paragraph(text('A '), text('bold', [{ type: 'bold' }]), text(' word')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('x'))] }] },
      ],
    };
    const html = richTextToHtml(doc);
    const { editor } = mount(html, html);
    expect(editor.json()).toEqual(doc);
  });

  it('falls back to the page markup when the stored value does not fit the schema', () => {
    const { editor } = mount(
      { type: 'doc', content: [{ type: 'mystery', content: [text('x')] }] },
      '<p>From the page</p>',
    );
    expect(editor.json()).toEqual({ type: 'doc', content: [paragraph(text('From the page'))] });
  });

  it('starts an empty stored document with one empty paragraph', () => {
    const { editor } = mount({ type: 'doc', content: [] });
    expect(editor.json()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: null } }],
    });
    expect(adminParse(editor.html())).toEqual(editor.json());
  });
});

describe('toolbar commands', () => {
  const plain: JSONContent = { type: 'doc', content: [paragraph(text('Hello world'))] };

  it('toggles bold, italic and strike on the selection', () => {
    const { element, editor, changes } = mount(plain);
    select(element, 'world');
    editor.run('bold');
    editor.run('italic');
    editor.run('strike');
    expect(editor.isActive('bold')).toBe(true);
    expect(editor.json().content?.[0]?.content?.[1]).toEqual(
      text('world', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }]),
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(editor.changed()).toBe(true);

    editor.run('bold');
    expect(editor.isActive('bold')).toBe(false);
  });

  it('sets, reads and removes a link', () => {
    const { element, editor } = mount(plain);
    select(element, 'Hello');
    editor.setLink('https://example.com');
    expect(editor.link()).toBe('https://example.com');
    expect(editor.json().content?.[0]?.content?.[0]?.marks?.[0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com' },
    });

    editor.setLink(null);
    expect(editor.link()).toBeNull();
    expect(editor.json()).toEqual(plain);
  });

  it('turns the block into a heading, a list or a quote and back', () => {
    const { element, editor } = mount(plain);
    select(element, 'Hello');

    editor.run('heading');
    expect(editor.json().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(editor.isActive('heading')).toBe(true);
    editor.run('heading');
    expect(editor.json().content?.[0]?.type).toBe('paragraph');

    editor.run('bulletList');
    expect(editor.json().content?.[0]?.type).toBe('bulletList');
    editor.run('orderedList');
    expect(editor.json().content?.[0]?.type).toBe('orderedList');
    editor.run('orderedList');
    expect(editor.json().content?.[0]?.type).toBe('paragraph');

    editor.run('blockquote');
    expect(editor.json().content?.[0]?.type).toBe('blockquote');
    expect(editor.isActive('blockquote')).toBe(true);
  });

  it('aligns the block', () => {
    const { element, editor } = mount(plain);
    select(element, 'Hello');
    editor.run('alignCenter');
    expect(editor.json().content?.[0]?.attrs).toEqual({ textAlign: 'center' });
    expect(editor.isActive('alignCenter')).toBe(true);
    editor.run('alignRight');
    expect(editor.isActive('alignRight')).toBe(true);
    expect(adminParse(editor.html())).toEqual(editor.json());
  });

  it('ignores a key it does not know', () => {
    const { editor } = mount(plain);
    editor.run('table');
    expect(editor.isActive('table')).toBe(false);
    expect(editor.changed()).toBe(false);
  });
});

describe('mounting on the page element', () => {
  it('edits the element itself and leaves its attributes as they were', () => {
    const { element, editor } = mount({ type: 'doc', content: [paragraph(text('x'))] });
    expect(element.getAttribute('contenteditable')).toBe('true');
    expect(element.querySelector('p')?.textContent).toBe('x');

    editor.destroy();
    editors = [];
    expect(element.getAttributeNames().sort()).toEqual(['class', 'data-manablox-field']);
    expect(element.className).toBe('prose');
  });
});
