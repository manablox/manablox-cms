import type { JSONContent } from '@tiptap/core';
import { hide, icon, iconButton, placeBar, separator, show, stylesheet } from './dom.js';
import type { RichTextEditor } from './inline-richtext.js';
import {
  FIELD_ATTRIBUTE,
  type FieldPath,
  type InlineEditable,
  PROTOCOL_VERSION,
  type PreviewDocument,
  type PreviewMessage,
  type PreviewMeta,
  parseFieldPath,
} from './protocol.js';

/**
 * In-place text editing in the preview frame: double-click edits a field from
 * `meta.editable`, keystrokes post the text, blur or Enter ends it, Escape cancels it. Text is
 * edited as plain text in the page's element; rich text gets a Tiptap editor with the admin's
 * schema (loaded on first use) and a toolbar.
 */

export interface InlineEditingOptions {
  post: (message: PreviewMessage) => void;
  /** An edit ended; a held-back document can be applied. */
  onFinish?: () => void;
}

export interface InlineEditing {
  /** The document being previewed (rich text starts from its stored value) and its meta. */
  setDocument(document: PreviewDocument | null, meta: PreviewMeta): void;
  isEditing(): boolean;
  /** Whether an event target is part of the toolbar rather than the page. */
  owns(target: EventTarget | null): boolean;
  destroy(): void;
}

interface TextEdit {
  kind: 'text';
  element: HTMLElement;
  key: string;
  original: string;
  originalText: string;
  /** An edit was sent; cancelling sends the original back. */
  posted: boolean;
}

interface RichTextEdit extends Omit<TextEdit, 'kind'> {
  kind: 'richtext';
  tools: Tool[];
  /** `null` while the editor loads. */
  editor: RichTextEditor | null;
  /** The editor's HTML of the value it started with. */
  originalHtml?: string;
}

type Edit = TextEdit | RichTextEdit;

const EDITABLE_ATTRIBUTE = 'data-manablox-editable';
const EDITING_ATTRIBUTE = 'data-manablox-editing';
const NS = 'manablox-inline';

const STYLE = `
[${EDITABLE_ATTRIBUTE}]{cursor:text}
[${EDITABLE_ATTRIBUTE}]:hover{outline:1px dashed rgba(124,108,247,.55);outline-offset:3px;border-radius:2px}
[${EDITING_ATTRIBUTE}]{outline:2px solid #22b8cf!important;outline-offset:3px;border-radius:2px;box-shadow:0 0 0 6px rgba(34,184,207,.12)}
[${EDITING_ATTRIBUTE}]:empty::before{content:attr(data-manablox-placeholder);opacity:.4}
.${NS}-bar{position:fixed;z-index:2147483001;display:flex;align-items:center;gap:1px;padding:3px;background:#fff;border:1px solid #ddd8f8;border-radius:9px;box-shadow:0 8px 24px rgba(28,21,51,.16),0 1px 2px rgba(28,21,51,.08);font:500 12px/1 system-ui,sans-serif;color:#1c1533}
.${NS}-bar *{box-sizing:border-box}
.${NS}-bar i{width:1px;height:16px;margin:0 3px;background:#e6e2fb}
.${NS}-bar button{all:unset;display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:#4b4373;cursor:pointer}
.${NS}-bar button:hover{background:#efedfd;color:#4a38e0}
.${NS}-bar button[aria-pressed="true"]{background:#e6e2fb;color:#4a38e0}
.${NS}-bar button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.${NS}-bar button b{font:700 13px/1 system-ui,sans-serif}
.${NS}-bar form{display:none;margin:0}
.${NS}-bar input{all:unset;box-sizing:border-box;width:260px;height:26px;padding:0 8px;border-radius:6px;background:#f6f5fe;color:#1c1533;font:500 12px/26px system-ui,sans-serif}
.${NS}-linking>:not(form){display:none!important}
.${NS}-linking>form{display:block}
`;

type Tool = { key: string; label: string; icon: string; group: number };

/** Every tool the frame knows; the field's settings pick which ones show. */
const TOOLS: Tool[] = [
  { key: 'bold', label: 'Bold', icon: '<b>B</b>', group: 0 },
  {
    key: 'italic',
    label: 'Italic',
    icon: '<b style="font-style:italic;font-weight:500">I</b>',
    group: 0,
  },
  {
    key: 'strike',
    label: 'Strikethrough',
    icon: '<b style="text-decoration:line-through;font-weight:500">S</b>',
    group: 0,
  },
  {
    key: 'link',
    label: 'Link',
    icon: icon(
      '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    ),
    group: 0,
  },
  {
    key: 'heading',
    label: 'Heading',
    icon: icon('<path d="M4 5v14M4 12h9M13 5v14"/><path d="M18 19v-7l-2 1.5"/>'),
    group: 1,
  },
  {
    key: 'bulletList',
    label: 'Bulleted list',
    icon: icon(
      '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    ),
    group: 1,
  },
  {
    key: 'orderedList',
    label: 'Numbered list',
    icon: icon('<path d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M4 14h2a1 1 0 0 1 0 2l-2 2h2"/>'),
    group: 1,
  },
  {
    key: 'blockquote',
    label: 'Quote',
    icon: icon('<path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z"/>'),
    group: 1,
  },
  {
    key: 'alignLeft',
    label: 'Align left',
    icon: icon('<path d="M4 6h16M4 12h10M4 18h14"/>'),
    group: 2,
  },
  {
    key: 'alignCenter',
    label: 'Align centre',
    icon: icon('<path d="M4 6h16M7 12h10M5 18h14"/>'),
    group: 2,
  },
  {
    key: 'alignRight',
    label: 'Align right',
    icon: icon('<path d="M4 6h16M10 12h10M6 18h14"/>'),
    group: 2,
  },
];

/** The editor module, loaded on the first rich text edit. */
let richText: Promise<typeof import('./inline-richtext.js')> | null = null;
function loadRichText() {
  richText ??= import('./inline-richtext.js');
  richText.catch(() => {
    richText = null;
  });
  return richText;
}

/** A block's and a repeater item's own keys; any other name is one of its fields. */
const OWN_BLOCK_KEYS = new Set(['blockId', 'type', 'fields', 'layout', 'ext']);
const OWN_ITEM_KEYS = new Set(['itemId', 'fields']);

/** A field's value in the document, addressed the way `data-manablox-field` names it. */
function valueAt(fields: unknown, path: FieldPath): unknown {
  let current = fields;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    const record = current as Record<string | number, unknown>;
    // An index skips into `{ grid, blocks }.blocks`; a field name on a block or item into `fields`.
    if (typeof segment === 'number' && Array.isArray(record.blocks)) current = record.blocks;
    else if (typeof segment === 'string' && typeof record.fields === 'object') {
      const own =
        typeof record.blockId === 'string'
          ? OWN_BLOCK_KEYS
          : typeof record.itemId === 'string'
            ? OWN_ITEM_KEYS
            : null;
      if (own && !own.has(segment)) current = record.fields;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

export function mountInlineEditing(options: InlineEditingOptions): InlineEditing {
  const doc = window.document;
  const style = stylesheet(STYLE);

  const bar = doc.createElement('div');
  bar.className = `${NS}-bar`;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Text');
  hide(bar);
  doc.body.appendChild(bar);
  // The toolbar must not take focus, or the selection it acts on would be gone; the link
  // field is the exception.
  bar.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  });

  // The link field: the frame may not open dialogs (the admin sandboxes it).
  const linkForm = doc.createElement('form');
  const linkInput = doc.createElement('input');
  linkInput.type = 'url';
  linkInput.placeholder = 'https://';
  linkInput.title = 'Enter links the selection; an empty address removes the link';
  linkInput.setAttribute('aria-label', 'Link address');
  linkForm.appendChild(linkInput);

  let editable: Record<string, InlineEditable> = {};
  let fields: Record<string, unknown> = {};
  let active: Edit | null = null;
  let timer = 0;
  let frame = 0;

  /** Tags the elements of editable fields. */
  function mark() {
    for (const element of doc.querySelectorAll<HTMLElement>(`[${FIELD_ATTRIBUTE}]`)) {
      const key = element.getAttribute(FIELD_ATTRIBUTE) ?? '';
      const entry = editable[key];
      if (entry) element.setAttribute(EDITABLE_ATTRIBUTE, entry.kind);
      else element.removeAttribute(EDITABLE_ATTRIBUTE);
    }
  }

  const observer = new MutationObserver(() => {
    if (!active) mark();
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  function send(edit: Edit, text: string, html: string) {
    edit.posted = true;
    options.post({
      v: PROTOCOL_VERSION,
      kind: 'editField',
      path: parseFieldPath(edit.key),
      inline: edit.kind,
      text,
      html,
    });
  }

  function post() {
    if (!active) return;
    if (active.kind === 'text') send(active, active.element.innerText, active.element.innerHTML);
    else if (active.editor?.changed()) send(active, active.editor.text(), active.editor.html());
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => post(), 150);
  }

  // --- the toolbar --------------------------------------------------------------------------

  function openLink(editor: RichTextEditor) {
    bar.classList.add(`${NS}-linking`);
    linkInput.value = editor.link() ?? '';
    linkInput.focus();
    linkInput.select();
    refreshBar();
  }

  /** Closes the link field, back to the editor. */
  function closeLink(editor: RichTextEditor | null) {
    if (!bar.classList.contains(`${NS}-linking`)) return;
    // Focus first: hiding the focused field would blur it toward nothing, ending the edit.
    editor?.focus();
    bar.classList.remove(`${NS}-linking`);
    refreshBar();
  }

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (active?.kind !== 'richtext' || !active.editor) return;
    const href = linkInput.value.trim();
    // Focuses the editor again, on the same selection.
    active.editor.setLink(href ? href : null);
    closeLink(active.editor);
    schedule();
  });

  linkInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeLink(active?.kind === 'richtext' ? active.editor : null);
  });

  // Leaving the field for anything but the editor or the toolbar ends the edit.
  linkInput.addEventListener('blur', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (bar.contains(next) || next === active?.element)) return;
    bar.classList.remove(`${NS}-linking`);
    finish();
  });

  function buildBar(tools: Tool[]) {
    bar.replaceChildren();
    let group = -1;
    for (const tool of tools) {
      if (group !== -1 && tool.group !== group) separator(bar);
      group = tool.group;
      iconButton(bar, {
        key: 'tool',
        value: tool.key,
        label: tool.label,
        icon: tool.icon,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (active?.kind !== 'richtext' || !active.editor) return;
          if (tool.key === 'link') {
            openLink(active.editor);
            return;
          }
          active.editor.run(tool.key);
          refreshBar();
        },
      });
    }
    if (tools.some((tool) => tool.key === 'link')) bar.appendChild(linkForm);
  }

  function refreshBar() {
    if (active?.kind !== 'richtext' || !active.editor || active.tools.length === 0) {
      hide(bar);
      return;
    }
    const editor = active.editor;
    for (const button of bar.querySelectorAll<HTMLButtonElement>('button')) {
      const key = button.dataset.tool ?? '';
      const pressed = key === 'link' ? editor.link() !== null : editor.isActive(key);
      button.setAttribute('aria-pressed', String(pressed));
    }
    show(bar);
    // Above the element if there is room, else below.
    placeBar(bar, active.element.getBoundingClientRect(), {
      gap: 8,
      fallback: 'below',
      align: 'start',
    });
  }

  const scheduleBar = () => {
    if (frame || !active) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refreshBar();
    });
  };

  // --- starting and ending an edit -----------------------------------------------------

  function start(element: HTMLElement, entry: InlineEditable) {
    if (active) finish();
    const key = element.getAttribute(FIELD_ATTRIBUTE) ?? '';
    element.setAttribute(EDITING_ATTRIBUTE, '');
    if (entry.kind === 'text') {
      active = {
        kind: 'text',
        element,
        key,
        original: element.innerHTML,
        originalText: element.innerText,
        posted: false,
      };
      element.setAttribute('data-manablox-placeholder', 'Type here');
      // Plain-text fields stay free of markup; the browser pastes plain text into them.
      element.contentEditable = 'plaintext-only';
      if (element.contentEditable !== 'plaintext-only') element.contentEditable = 'true';
      element.focus();
      return;
    }

    const edit: RichTextEdit = {
      kind: 'richtext',
      element,
      key,
      original: element.innerHTML,
      originalText: element.innerText,
      posted: false,
      tools: TOOLS.filter((tool) => entry.toolbar.includes(tool.key)),
      editor: null,
    };
    active = edit;
    // The stored document, so the editor holds exactly what the admin does.
    const stored = valueAt(fields, parseFieldPath(key));
    loadRichText()
      .then(({ createRichTextEditor }) => {
        if (active !== edit) return;
        edit.editor = createRichTextEditor(element, {
          content:
            typeof stored === 'string' || (typeof stored === 'object' && stored !== null)
              ? (stored as JSONContent | string)
              : edit.original,
          fallback: edit.original,
          onChange: schedule,
          onSelection: scheduleBar,
        });
        edit.originalHtml = edit.editor.html();
        buildBar(edit.tools);
        refreshBar();
      })
      .catch((error: unknown) => {
        console.error('[manablox] The rich text editor did not load', error);
        if (active === edit) finish(true);
      });
  }

  function finish(cancel = false) {
    if (!active) return;
    window.clearTimeout(timer);
    const edit = active;
    if (!cancel) post();
    if (edit.kind === 'richtext') {
      const editor = edit.editor;
      const changed = !cancel && Boolean(editor?.changed());
      const html = editor?.html() ?? '';
      editor?.destroy();
      edit.element.innerHTML = changed ? html : edit.original;
      // Edits already sent are taken back.
      if (cancel && edit.posted) send(edit, edit.originalText, edit.originalHtml ?? edit.original);
    } else {
      if (cancel) {
        edit.element.innerHTML = edit.original;
        if (edit.posted) send(edit, edit.originalText, edit.original);
      }
      edit.element.removeAttribute('data-manablox-placeholder');
      edit.element.contentEditable = 'inherit';
    }
    edit.element.removeAttribute(EDITING_ATTRIBUTE);
    active = null;
    bar.classList.remove(`${NS}-linking`);
    hide(bar);
    options.onFinish?.();
  }

  const onDoubleClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      `[${EDITABLE_ATTRIBUTE}]`,
    );
    if (!target || target === active?.element) return;
    const entry = editable[target.getAttribute(FIELD_ATTRIBUTE) ?? ''];
    if (!entry) return;
    event.preventDefault();
    event.stopPropagation();
    start(target, entry);
  };

  // Rich text reports its changes through the editor.
  const onInput = (event: Event) => {
    if (active?.kind === 'text' && event.target === active.element) schedule();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!active || event.target !== active.element) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Enter' && active.kind === 'text') {
      event.preventDefault();
      finish();
    }
  };

  const onBlur = (event: FocusEvent) => {
    if (!active || event.target !== active.element) return;
    // Some browsers still blur toward the toolbar.
    if (event.relatedTarget instanceof Node && bar.contains(event.relatedTarget)) return;
    finish();
  };

  // Where `plaintext-only` is unknown, a paste into a text field is still plain text.
  const onPaste = (event: ClipboardEvent) => {
    if (active?.kind !== 'text' || event.target !== active.element) return;
    if (active.element.contentEditable === 'plaintext-only') return;
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const text = doc.createTextNode(event.clipboardData?.getData('text/plain') ?? '');
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    schedule();
  };

  doc.addEventListener('dblclick', onDoubleClick, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('blur', onBlur, true);
  doc.addEventListener('paste', onPaste, true);
  window.addEventListener('scroll', scheduleBar, true);
  window.addEventListener('resize', scheduleBar);

  return {
    setDocument(document, meta) {
      fields = document?.fields ?? {};
      editable = meta.readOnly ? {} : meta.editable;
      if (!active) mark();
    },
    isEditing: () => active !== null,
    owns: (target) => target instanceof Node && bar.contains(target),
    destroy() {
      finish(true);
      observer.disconnect();
      cancelAnimationFrame(frame);
      doc.removeEventListener('dblclick', onDoubleClick, true);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('blur', onBlur, true);
      doc.removeEventListener('paste', onPaste, true);
      window.removeEventListener('scroll', scheduleBar, true);
      window.removeEventListener('resize', scheduleBar);
      bar.remove();
      style.remove();
    },
  };
}
