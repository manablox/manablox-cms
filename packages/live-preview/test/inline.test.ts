import { type Editor, generateJSON } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInlineEditing } from '../src/inline.js';
import { connectPreview } from '../src/preview.js';
import {
  type EditorMessage,
  PROTOCOL_VERSION,
  type PreviewDocument,
  type PreviewMessage,
  type PreviewMeta,
} from '../src/protocol.js';
import { richTextExtensions } from '../src/rich-text.js';

/** In-place editing, and documents arriving mid-edit waiting for it to end. */

const EDITOR_ORIGIN = 'https://admin.example';

const editable = (path: string, kind: 'text' | 'richtext' = 'text'): PreviewMeta => ({
  editable: { [path]: kind === 'text' ? { kind: 'text' } : { kind: 'richtext', toolbar: [] } },
  labels: {},
  grids: {},
});

let posted: PreviewMessage[];
const teardown: Array<() => void> = [];

beforeEach(() => {
  posted = [];
  document.body.innerHTML = '';
  vi.spyOn(window, 'parent', 'get').mockReturnValue({
    postMessage: (message: PreviewMessage) => posted.push(message),
  } as unknown as Window);
});

afterEach(() => {
  while (teardown.length) teardown.pop()?.();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function fieldElement(path: string, text = 'Original'): HTMLElement {
  const element = document.createElement('h1');
  element.setAttribute('data-manablox-field', path);
  element.textContent = text;
  document.body.appendChild(element);
  return element;
}

describe('inline editing', () => {
  it('marks only the fields the editor says are editable', () => {
    const marked = fieldElement('title');
    const plain = fieldElement('summary');
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);

    inline.setDocument(null, editable('title'));

    expect(marked.getAttribute('data-manablox-editable')).toBe('text');
    expect(plain.hasAttribute('data-manablox-editable')).toBe(false);
  });

  it('marks nothing for a read-only viewer', () => {
    const element = fieldElement('title');
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);

    inline.setDocument(null, { ...editable('title'), readOnly: true });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(element.hasAttribute('data-manablox-editable')).toBe(false);
    expect(inline.isEditing()).toBe(false);
  });

  it('starts an edit on a double-click and reports the text when Enter ends it', () => {
    const element = fieldElement('title');
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);
    inline.setDocument(null, editable('title'));

    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(inline.isEditing()).toBe(true);
    expect(element.isContentEditable || element.getAttribute('contenteditable')).toBeTruthy();

    element.textContent = 'Edited';
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(inline.isEditing()).toBe(false);
    const edit = posted.find((message) => message.kind === 'editField');
    expect(edit).toMatchObject({ kind: 'editField', path: ['title'], text: 'Edited' });
  });

  it('restores the original text when Escape cancels an edit', () => {
    const element = fieldElement('title', 'Original');
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);
    inline.setDocument(null, editable('title'));

    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    element.textContent = 'Half-typed';
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(inline.isEditing()).toBe(false);
    expect(element.textContent).toBe('Original');
  });

  it('leaves a field alone that the editor did not mark editable', () => {
    const element = fieldElement('summary');
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);
    inline.setDocument(null, editable('title'));

    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(inline.isEditing()).toBe(false);
  });
});

describe('inline rich text', () => {
  const STORED = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { textAlign: null },
        content: [{ type: 'text', text: 'Hello world' }],
      },
    ],
  };
  const meta: PreviewMeta = {
    editable: { 'components.0.body': { kind: 'richtext', toolbar: ['bold', 'link', 'heading'] } },
    labels: {},
    grids: {},
  };
  const previewDocument: PreviewDocument = {
    id: 'doc-1',
    typeId: 'type-1',
    typeName: 'page',
    locale: 'en',
    title: 'Page',
    slug: 'page',
    permalink: null,
    fields: {
      components: {
        grid: null,
        blocks: [{ blockId: 'b1', type: 'teaser', fields: { body: STORED } }],
      },
    },
  };

  /** The page's rendering of the field; the editor starts from the stored document instead. */
  function richElement(): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('data-manablox-field', 'components.0.body');
    element.className = 'body';
    element.innerHTML = '<p>Hello <b>rendered</b> world</p>';
    document.body.appendChild(element);
    return element;
  }

  async function startEditing(element: HTMLElement) {
    const inline = mountInlineEditing({ post: (m) => posted.push(m), onFinish: () => {} });
    teardown.push(inline.destroy);
    inline.setDocument(previewDocument, meta);
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(element.getAttribute('contenteditable')).toBe('true'));
    const tiptap = (element as HTMLElement & { editor: Editor }).editor;
    return { inline, tiptap };
  }

  const button = (label: string) =>
    document.querySelector<HTMLButtonElement>(`.manablox-inline-bar button[aria-label="${label}"]`);

  const lastEdit = () =>
    posted.filter((message) => message.kind === 'editField').at(-1) as
      | Extract<PreviewMessage, { kind: 'editField' }>
      | undefined;

  it('edits the stored document with the toolbar the field allows', async () => {
    const element = richElement();
    const { inline, tiptap } = await startEditing(element);
    expect(element.textContent).toBe('Hello world');
    expect(button('Bold')).not.toBeNull();
    expect(button('Italic')).toBeNull();

    tiptap.commands.setTextSelection({ from: 7, to: 12 });
    button('Bold')?.click();
    expect(button('Bold')?.getAttribute('aria-pressed')).toBe('true');

    // The link field in the toolbar, not a dialog: the admin's sandbox allows none.
    tiptap.commands.setTextSelection({ from: 1, to: 6 });
    button('Link')?.click();
    const field = document.querySelector<HTMLInputElement>(
      '.manablox-inline-bar input[aria-label="Link address"]',
    );
    expect(field?.checkVisibility()).not.toBe(false);
    expect(document.activeElement).toBe(field);
    expect(inline.isEditing()).toBe(true);
    if (field) field.value = 'https://example.com';
    field?.form?.requestSubmit();
    expect(document.activeElement).toBe(element);
    expect(button('Link')?.getAttribute('aria-pressed')).toBe('true');

    element.dispatchEvent(new FocusEvent('blur'));
    expect(inline.isEditing()).toBe(false);

    const edit = lastEdit();
    expect(edit).toMatchObject({ path: ['components', 0, 'body'], inline: 'richtext' });
    expect(generateJSON(edit?.html ?? '', richTextExtensions())).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            {
              type: 'text',
              text: 'Hello',
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
            { type: 'text', text: ' ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
    // The page shows the edit until the next document arrives, and the element is its own again.
    expect(element.querySelector('strong')?.textContent).toBe('world');
    expect(element.hasAttribute('contenteditable')).toBe(false);
    expect(element.className).toBe('body');
  });

  it('closes the link field on Escape without linking, and removes a link on an empty address', async () => {
    const element = richElement();
    const { inline, tiptap } = await startEditing(element);
    tiptap.commands.setTextSelection({ from: 1, to: 6 });
    const field = () =>
      document.querySelector<HTMLInputElement>('.manablox-inline-bar input') as HTMLInputElement;

    button('Link')?.click();
    field().value = 'https://example.com';
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inline.isEditing()).toBe(true);
    expect(tiptap.isActive('link')).toBe(false);

    button('Link')?.click();
    field().value = 'https://example.com';
    field().form?.requestSubmit();
    expect(tiptap.isActive('link')).toBe(true);

    button('Link')?.click();
    expect(field().value).toBe('https://example.com');
    field().value = ' ';
    field().form?.requestSubmit();
    expect(tiptap.isActive('link')).toBe(false);
  });

  it('undoes a toolbar command with the editor history', async () => {
    const element = richElement();
    const { tiptap } = await startEditing(element);
    tiptap.commands.setTextSelection({ from: 7, to: 12 });
    button('Bold')?.click();
    expect(tiptap.isActive('bold')).toBe(true);

    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: !mac, metaKey: mac, bubbles: true }),
    );
    expect(tiptap.getJSON()).toEqual(STORED);
  });

  it('posts nothing for an edit that changed nothing, and restores the page markup', async () => {
    const element = richElement();
    const { inline } = await startEditing(element);
    element.dispatchEvent(new FocusEvent('blur'));
    expect(inline.isEditing()).toBe(false);
    expect(lastEdit()).toBeUndefined();
    expect(element.innerHTML).toBe('<p>Hello <b>rendered</b> world</p>');
  });

  it('takes back what was sent when Escape cancels', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const element = richElement();
      const { tiptap } = await startEditing(element);
      tiptap.commands.setTextSelection({ from: 7, to: 12 });
      button('Heading')?.click();
      vi.advanceTimersByTime(200);
      expect(lastEdit()?.html).toContain('<h2');

      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(generateJSON(lastEdit()?.html ?? '', richTextExtensions())).toEqual(STORED);
      expect(element.innerHTML).toBe('<p>Hello <b>rendered</b> world</p>');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a document arriving mid-edit', () => {
  const DOCUMENT: PreviewDocument = {
    id: 'doc-1',
    typeId: 'type-1',
    typeName: 'article',
    locale: 'en',
    title: 'Original',
    slug: 'original',
    permalink: null,
    fields: {},
  };

  function documentMessage(meta: PreviewMeta): EditorMessage {
    return { v: PROTOCOL_VERSION, kind: 'document', document: DOCUMENT, meta };
  }

  it('waits for the edit to finish rather than replacing the element holding the caret', () => {
    const element = fieldElement('title');
    const onDocument = vi.fn();
    const stop = connectPreview({ editorOrigin: EDITOR_ORIGIN, onDocument, clickToEdit: true });
    teardown.push(stop);

    const meta = editable('title');
    window.dispatchEvent(
      new MessageEvent('message', { data: documentMessage(meta), origin: EDITOR_ORIGIN }),
    );
    expect(onDocument).toHaveBeenCalledTimes(1);

    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    // Held, not applied, while editing.
    window.dispatchEvent(
      new MessageEvent('message', { data: documentMessage(meta), origin: EDITOR_ORIGIN }),
    );
    expect(onDocument).toHaveBeenCalledTimes(1);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDocument).toHaveBeenCalledTimes(2);
  });
});
