import { createPluginHandlers } from './plugins.js';
import {
  type BlockBreakpoint,
  type BlockPlacement,
  type EditorMessage,
  type FieldPath,
  type InlineKind,
  isPluginMessage,
  isPreviewMessage,
  type PluginChannel,
  type PluginChannelMap,
  PROTOCOL_VERSION,
  type PreviewCapabilities,
  type PreviewDocument,
  type PreviewMessage,
  type PreviewMeta,
} from './protocol.js';

/** What the previewed site asks the editor to do. */
export interface PreviewRequestHandlers {
  onMoveBlock?: (list: FieldPath, from: number, to: number) => void;
  onRemoveBlock?: (list: FieldPath, index: number) => void;
  /** The frame asked for a new block at `index`; the editor picks the type. */
  onAddBlock?: (list: FieldPath, index: number) => void;
  /** A block was placed on its grid at one breakpoint; `null` resets it to auto-placement. */
  onLayoutBlock?: (
    list: FieldPath,
    index: number,
    breakpoint: BlockBreakpoint,
    placement: BlockPlacement | null,
  ) => void;
  /** A field was edited in place; `html` matters for rich text. */
  onEditField?: (path: FieldPath, inline: InlineKind, text: string, html: string) => void;
  onSelectField?: (path: FieldPath) => void;
  onRequestSave?: () => void;
}

export interface EditorChannelOptions extends PreviewRequestHandlers {
  iframe: HTMLIFrameElement;
  /** Origin of the previewed site, from the space's configured URL. */
  previewOrigin: string;
  onReady?: (capabilities: PreviewCapabilities) => void;
}

const EMPTY_META: PreviewMeta = { editable: {}, labels: {}, grids: {} };

/** Runs in the admin, alongside the preview iframe. */
export function createEditorChannel(options: EditorChannelOptions) {
  let ready = false;
  let pending: { document: PreviewDocument; meta: PreviewMeta } | null = null;
  let plugins = new Set<string>();
  const queued = new Map<string, { plugin: string; name: string; payload: unknown }>();
  const handlers = createPluginHandlers();

  const send = (message: EditorMessage) => {
    options.iframe.contentWindow?.postMessage(message, options.previewOrigin);
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== options.previewOrigin) return;
    if (event.source !== options.iframe.contentWindow) return;
    if (!isPreviewMessage(event.data)) return;

    if (isPluginMessage(event.data)) {
      handlers.dispatch(event.data);
      return;
    }
    const message = event.data as PreviewMessage;
    switch (message.kind) {
      case 'ready':
        ready = true;
        plugins = new Set(
          Array.isArray(message.capabilities?.plugins) ? message.capabilities.plugins : [],
        );
        options.onReady?.(message.capabilities);
        // Send what was queued before the frame was ready.
        for (const { plugin, name, payload } of queued.values()) sendPlugin(plugin, name, payload);
        queued.clear();
        if (pending) {
          send({ v: PROTOCOL_VERSION, kind: 'document', ...pending });
          pending = null;
        }
        break;
      case 'moveBlock':
        options.onMoveBlock?.(message.list, message.from, message.to);
        break;
      case 'removeBlock':
        options.onRemoveBlock?.(message.list, message.index);
        break;
      case 'addBlock':
        options.onAddBlock?.(message.list, message.index);
        break;
      case 'layoutBlock':
        options.onLayoutBlock?.(message.list, message.index, message.breakpoint, message.placement);
        break;
      case 'editField':
        options.onEditField?.(message.path, message.inline, message.text, message.html);
        break;
      case 'selectField':
        options.onSelectField?.(message.path);
        break;
      case 'requestSave':
        options.onRequestSave?.();
        break;
    }
  };

  const sendPlugin = (plugin: string, name: string, payload: unknown) => {
    if (plugins.has(plugin)) send({ v: PROTOCOL_VERSION, kind: 'plugin', plugin, name, payload });
  };

  window.addEventListener('message', onMessage);

  return {
    setDocument(document: PreviewDocument, meta: PreviewMeta = EMPTY_META) {
      if (!ready) {
        pending = { document, meta };
        return;
      }
      send({ v: PROTOCOL_VERSION, kind: 'document', document, meta });
    },
    highlight(path: FieldPath | null) {
      if (ready) send({ v: PROTOCOL_VERSION, kind: 'highlight', path });
    },
    /** A plugin's channel; sends before `ready` keep the last payload per name. */
    plugin<M extends PluginChannelMap = PluginChannelMap>(
      id: string,
    ): PluginChannel<M['toPreview'], M['toEditor']> {
      return {
        send(name, payload) {
          if (ready) sendPlugin(id, name, payload);
          else {
            const key = `${id}\u0000${name}`;
            const entry = queued.get(key);
            if (entry) entry.payload = payload;
            else queued.set(key, { plugin: id, name, payload });
          }
        },
        on(name, handler) {
          return handlers.on(id, name, handler as (payload: unknown) => void);
        },
      };
    },
    destroy() {
      window.removeEventListener('message', onMessage);
    },
  };
}
