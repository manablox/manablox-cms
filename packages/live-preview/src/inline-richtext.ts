import { Editor, type Extensions, getSchema, type JSONContent } from '@tiptap/core';
import { richTextExtensions } from './rich-text.js';

/**
 * The frame's rich text editor: Tiptap mounted on the page's own element, with the admin's
 * schema. Loaded on the first rich text edit, so pages that never edit do not load Tiptap.
 */

/** The toolbar keys this editor runs; the field's settings pick which ones show. */
export type RichTextCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight';

type Commands = Record<
  RichTextCommand,
  { run: (editor: Editor) => boolean; active: (editor: Editor) => boolean }
>;

const COMMANDS: Commands = {
  bold: {
    run: (editor) => editor.chain().focus().toggleBold().run(),
    active: (editor) => editor.isActive('bold'),
  },
  italic: {
    run: (editor) => editor.chain().focus().toggleItalic().run(),
    active: (editor) => editor.isActive('italic'),
  },
  strike: {
    run: (editor) => editor.chain().focus().toggleStrike().run(),
    active: (editor) => editor.isActive('strike'),
  },
  heading: {
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (editor) => editor.isActive('heading', { level: 2 }),
  },
  bulletList: {
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    active: (editor) => editor.isActive('bulletList'),
  },
  orderedList: {
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive('orderedList'),
  },
  blockquote: {
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive('blockquote'),
  },
  alignLeft: {
    run: (editor) => editor.chain().focus().setTextAlign('left').run(),
    active: (editor) => editor.isActive({ textAlign: 'left' }),
  },
  alignCenter: {
    run: (editor) => editor.chain().focus().setTextAlign('center').run(),
    active: (editor) => editor.isActive({ textAlign: 'center' }),
  },
  alignRight: {
    run: (editor) => editor.chain().focus().setTextAlign('right').run(),
    active: (editor) => editor.isActive({ textAlign: 'right' }),
  },
};

export interface RichTextEditorOptions {
  /** The stored document, or HTML. */
  content: JSONContent | string;
  /** HTML used when `content` does not fit the schema: the page's own markup. */
  fallback: string;
  /** The document changed. */
  onChange: () => void;
  /** The selection or the marks at the caret changed. */
  onSelection: () => void;
}

export interface RichTextEditor {
  /** Runs a toolbar command on the selection; unknown keys do nothing. */
  run(command: string): void;
  isActive(command: string): boolean;
  /** The link at the selection, if any. */
  link(): string | null;
  /** Links the selection (or the link the caret is in) to `href`; `null` removes the link. */
  setLink(href: string | null): void;
  /** Focuses the editor, keeping its selection. */
  focus(): void;
  json(): JSONContent;
  /** The document as HTML; the admin parses it with the same schema. */
  html(): string;
  text(): string;
  /** Whether the document differs from the one the edit started with. */
  changed(): boolean;
  /** Unmounts, leaving the element's attributes as they were and its children empty. */
  destroy(): void;
}

/** The stored document if it parses, an empty one as one empty paragraph, else the page's HTML. */
function startingContent(options: RichTextEditorOptions, extensions: Extensions) {
  const { content } = options;
  if (typeof content === 'object' && content.type === 'doc' && !content.content?.length) return '';
  return fits(content, extensions) ? content : options.fallback;
}

/** Whether a document parses with the schema; the admin's editor accepts the same ones. */
function fits(content: JSONContent | string, extensions: Extensions): boolean {
  if (typeof content === 'string') return true;
  if (content.type !== 'doc') return false;
  try {
    getSchema(extensions).nodeFromJSON(content);
    return true;
  } catch {
    return false;
  }
}

function isCommand(key: string): key is RichTextCommand {
  return Object.hasOwn(COMMANDS, key);
}

/** Mounts an editor on `element` itself, so the page's own styles still apply. */
export function createRichTextEditor(
  element: HTMLElement,
  options: RichTextEditorOptions,
): RichTextEditor {
  const attributes = new Map(
    element.getAttributeNames().map((name) => [name, element.getAttribute(name) ?? '']),
  );
  const extensions = richTextExtensions();
  const editor = new Editor({
    element: { mount: element },
    extensions,
    content: startingContent(options, extensions),
    autofocus: 'end',
    onUpdate: () => options.onChange(),
    onSelectionUpdate: () => options.onSelection(),
    onTransaction: () => options.onSelection(),
  });
  const initial = JSON.stringify(editor.getJSON());

  return {
    run(command) {
      if (isCommand(command)) COMMANDS[command].run(editor);
    },
    isActive: (command) => isCommand(command) && COMMANDS[command].active(editor),
    link: () => (editor.getAttributes('link').href as string | undefined) ?? null,
    setLink(href) {
      const chain = editor.chain().focus().extendMarkRange('link');
      if (href === null) chain.unsetLink().run();
      else chain.setLink({ href }).run();
    },
    // At once, not on the next frame as the focus command does.
    focus: () => editor.view.focus(),
    json: () => editor.getJSON(),
    html: () => editor.getHTML(),
    text: () => editor.getText({ blockSeparator: '\n' }),
    changed: () => JSON.stringify(editor.getJSON()) !== initial,
    destroy() {
      editor.destroy();
      for (const name of element.getAttributeNames()) {
        if (!attributes.has(name)) element.removeAttribute(name);
      }
      for (const [name, value] of attributes) element.setAttribute(name, value);
    },
  };
}
