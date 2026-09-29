import { mountBlockControls } from './controls.js';
import { mountInlineEditing } from './inline.js';
import { createPluginHandlers } from './plugins.js';
import {
  type EditorMessage,
  FIELD_ATTRIBUTE,
  type FieldPath,
  isEditorMessage,
  isPluginMessage,
  type PluginChannel,
  type PluginChannelMap,
  PROTOCOL_VERSION,
  type PreviewDocument,
  type PreviewMessage,
  type PreviewMeta,
  parseFieldPath,
} from './protocol.js';

export interface PreviewOptions {
  /** Origin of the admin; messages from any other origin are ignored. */
  editorOrigin: string;
  /** Renders a new document. `meta.grids` holds each block field's grid per breakpoint. */
  onDocument: (document: PreviewDocument, meta: PreviewMeta) => void;
  onHighlight?: (path: FieldPath | null) => void;
  /** Enables click-to-edit on elements carrying `data-manablox-field`. */
  clickToEdit?: boolean;
  /** A move/resize/add/delete toolbar on tagged blocks. Defaults to `clickToEdit`. */
  blockControls?: boolean;
  /** Double-click editing of editable text and rich text fields. Defaults to `clickToEdit`. */
  inlineEditing?: boolean;
  /** The plugin channels this frame handles, reported to the editor. */
  plugins?: string[];
  /** Sends to the editor. Defaults to the parent window at `editorOrigin`. */
  post?: (message: PreviewMessage) => void;
}

/** Disconnects when called; `plugin(id)` opens a plugin's channel. */
export type PreviewConnection = (() => void) & {
  plugin<M extends PluginChannelMap = PluginChannelMap>(
    id: string,
  ): PluginChannel<M['toEditor'], M['toPreview']>;
};

function connection(
  disconnect: () => void,
  post: ((message: PreviewMessage) => void) | null,
  handlers: ReturnType<typeof createPluginHandlers>,
): PreviewConnection {
  return Object.assign(disconnect, {
    plugin<M extends PluginChannelMap = PluginChannelMap>(
      id: string,
    ): PluginChannel<M['toEditor'], M['toPreview']> {
      return {
        send(name, payload) {
          post?.({ v: PROTOCOL_VERSION, kind: 'plugin', plugin: id, name, payload });
        },
        on(name, handler) {
          return handlers.on(id, name, handler as (payload: unknown) => void);
        },
      };
    },
  });
}

/** Connects the previewed site to the editor. Call once on mount of a `/preview` route. */
export function connectPreview(options: PreviewOptions): PreviewConnection {
  const handlers = createPluginHandlers();
  if (!options.post && (typeof window === 'undefined' || window.parent === window))
    return connection(() => {}, null, handlers);

  const post =
    options.post ??
    ((message: PreviewMessage) => {
      window.parent.postMessage(message, options.editorOrigin);
    });

  const blockControls = options.blockControls ?? Boolean(options.clickToEdit);
  const inlineEditing = options.inlineEditing ?? Boolean(options.clickToEdit);

  const controls = blockControls ? mountBlockControls({ post }) : null;

  // Documents arriving mid-edit wait, so the caret's element is not replaced.
  let held: { document: PreviewDocument; meta: PreviewMeta } | null = null;
  const apply = (document: PreviewDocument, meta: PreviewMeta) => {
    options.onDocument(document, meta);
    controls?.setMeta(meta);
    inline?.setDocument(document, meta);
    controls?.documentChanged();
  };
  const inline = inlineEditing
    ? mountInlineEditing({
        post,
        onFinish: () => {
          if (held) {
            const next = held;
            held = null;
            apply(next.document, next.meta);
          }
        },
      })
    : null;

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== options.editorOrigin) return;
    if (isPluginMessage(event.data)) {
      handlers.dispatch(event.data);
      return;
    }
    if (!isEditorMessage(event.data)) return;

    const message = event.data as EditorMessage;
    if (message.kind === 'document') {
      if (inline?.isEditing()) held = { document: message.document, meta: message.meta };
      else apply(message.document, message.meta);
    }
    if (message.kind === 'highlight') {
      options.onHighlight?.(message.path);
      controls?.setHighlight(message.path);
    }
  };

  const onClick = (event: MouseEvent) => {
    if (!options.clickToEdit) return;
    if (controls?.owns(event.target) || inline?.owns(event.target) || inline?.isEditing()) return;
    // A double-click is an inline edit, not a selection.
    if (event.detail > 1) return;
    const target = (event.target as HTMLElement | null)?.closest(`[${FIELD_ATTRIBUTE}]`);
    if (!target) return;
    const raw = target.getAttribute(FIELD_ATTRIBUTE);
    if (!raw) return;
    event.preventDefault();
    post({ v: PROTOCOL_VERSION, kind: 'selectField', path: parseFieldPath(raw) });
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('click', onClick, true);

  post({
    v: PROTOCOL_VERSION,
    kind: 'ready',
    capabilities: {
      fields: Boolean(options.clickToEdit),
      blocks: blockControls,
      inline: inlineEditing,
      ...(options.plugins?.length ? { plugins: [...options.plugins] } : {}),
    },
  });

  return connection(
    () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('click', onClick, true);
      controls?.destroy();
      inline?.destroy();
    },
    post,
    handlers,
  );
}

/** Asks the editor to move a block within a list, for the page's own drag handles. */
export function requestBlockMove(
  editorOrigin: string,
  list: FieldPath | string,
  from: number,
  to: number,
): void {
  window.parent.postMessage(
    {
      v: PROTOCOL_VERSION,
      kind: 'moveBlock',
      list: typeof list === 'string' ? [list] : list,
      from,
      to,
    } satisfies PreviewMessage,
    editorOrigin,
  );
}
