import type { BlockBreakpoint } from '@manablox/core';
import { createEditorChannel } from '@manablox/live-preview';
import {
  type CanvasFocus,
  type NodeRef,
  type SiteRenderInput,
  WEBSITE_CHANNEL,
  type WebsiteCanvasMessages,
} from '@manablox/site';
import { onScopeDispose, type Ref, ref, watch } from 'vue';
import { plainCopier } from './model/plain-data';

/** What the canvas renders: the input, the draft stylesheet and the design in focus. */
export interface CanvasPayload {
  input: SiteRenderInput;
  css: string;
  focus?: CanvasFocus | null;
}

type Requests = WebsiteCanvasMessages['toEditor'];

/** The canvas's design requests by name; each is optional. */
type CanvasHandlers = { [K in keyof Requests]?: (payload: Requests[K]) => void };

export interface DesignCanvasOptions {
  iframe: Ref<HTMLIFrameElement | null>;
  /** The site process origin. */
  origin: () => string | null;
  payload: () => CanvasPayload | null;
  highlight: () => NodeRef[];
  breakpoint: () => BlockBreakpoint;
  scheme: () => 'light' | 'dark';
  /** Selection passes; edit requests are dropped. */
  readOnly: () => boolean;
  on: CanvasHandlers;
}

/** Requests that only pass while the canvas is editable. */
const EDITS: ReadonlySet<keyof Requests> = new Set([
  'moveNode',
  'insertNode',
  'removeNode',
  'editText',
  'resizeNode',
]);

/** Keeps the site canvas in step over the live-preview channel's `website` messages. */
export function useDesignCanvas(options: DesignCanvasOptions) {
  const connected = ref(false);
  let channel: ReturnType<typeof createEditorChannel> | null = null;
  let website: ReturnType<typeof websiteChannel> | null = null;

  // Unchanged designs keep their copies, so an edit copies only what it replaced.
  const plain = plainCopier();

  const websiteChannel = (editor: ReturnType<typeof createEditorChannel>) =>
    editor.plugin<WebsiteCanvasMessages>(WEBSITE_CHANNEL);

  function sendDesign() {
    const payload = options.payload();
    if (!website || !payload) return;
    website.send('design', {
      input: plain(payload.input) as unknown as Record<string, unknown>,
      css: payload.css,
      focus: payload.focus ?? null,
      readOnly: options.readOnly(),
    });
  }

  function disconnect() {
    channel?.destroy();
    channel = null;
    website = null;
    connected.value = false;
  }

  function connect() {
    disconnect();
    const frame = options.iframe.value;
    const origin = options.origin();
    if (!frame || !origin) return;
    channel = createEditorChannel({
      iframe: frame,
      previewOrigin: origin,
      onReady: () => {
        connected.value = true;
        // The frame may have reloaded; send everything again.
        sendDesign();
        website?.send('breakpoint', { breakpoint: options.breakpoint() });
        website?.send('scheme', { scheme: options.scheme() });
        website?.send('highlight', { nodes: options.highlight() });
      },
    });
    website = websiteChannel(channel);
    for (const [name, handler] of Object.entries(options.on)) {
      const request = name as keyof Requests;
      website.on(request, (payload) => {
        if (!EDITS.has(request) || !options.readOnly())
          (handler as (value: unknown) => void)(payload);
      });
    }
    // Queued until the canvas says it is ready.
    sendDesign();
  }

  watch([options.iframe, options.origin], connect, { flush: 'post', immediate: true });
  watch([options.payload, options.readOnly], sendDesign);
  watch(options.breakpoint, (breakpoint) => website?.send('breakpoint', { breakpoint }));
  watch(options.scheme, (scheme) => website?.send('scheme', { scheme }));
  watch(
    () => options.highlight().join(' '),
    () => website?.send('highlight', { nodes: options.highlight() }),
  );
  onScopeDispose(disconnect);

  /** Relays a palette drag at canvas coordinates; the frame cannot receive it itself. */
  function paletteDrag(phase: 'over' | 'drop' | 'leave', element: string, x: number, y: number) {
    if (!options.readOnly()) website?.send('paletteDrag', { phase, element, x, y });
  }

  return { connected, paletteDrag };
}
