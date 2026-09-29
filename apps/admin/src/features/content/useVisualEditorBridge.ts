import type { AdminPreviewFrame, AdminPreviewTarget } from '@manablox/admin-plugin';
import type { DraftDocument } from '@manablox/admin-sdk/features/content/model/draft';
import type { ContentTypeSummary, FieldTypeMeta } from '@manablox/admin-sdk/lib/api-types';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import {
  createEditorChannel,
  type FieldPath,
  type PreviewDocument,
  type PreviewRequestHandlers,
  samePath,
} from '@manablox/live-preview';
import { computed, onScopeDispose, type Ref, ref, watch } from 'vue';
import { buildPreviewMeta, withBlockTypeNames } from './model/preview';

/** The content requests a frontend preview sends. */
export type ContentRequestHandlers = Pick<
  PreviewRequestHandlers,
  | 'onMoveBlock'
  | 'onRemoveBlock'
  | 'onAddBlock'
  | 'onLayoutBlock'
  | 'onEditField'
  | 'onSelectField'
  | 'onRequestSave'
>;

export interface VisualEditorBridgeOptions {
  iframe: Ref<HTMLIFrameElement | null>;
  /** The space's frontend URL; the preview lives at its `/preview` route. */
  siteUrl: () => string | null | undefined;
  /** Framed instead of the frontend when set, see `content.preview.target`. */
  target?: () => AdminPreviewTarget | null;
  doc: () => DraftDocument | null;
  /** Bumped on every draft edit; see `useDraftForm`. */
  revision: () => number;
  contentType: () => ContentTypeSummary | null;
  typeById: (id: string) => ContentTypeSummary | null;
  fieldTypeMeta: (name: string) => FieldTypeMeta | null;
  /** The selected block; the frame outlines it. */
  highlighted: () => FieldPath | null;
  /** The frame gets no editing controls and its edit requests are dropped. */
  readOnly?: () => boolean;
  on: Required<ContentRequestHandlers>;
}

/** Keeps the preview iframe in step with the draft over the `@manablox/live-preview` channel. */
export function useVisualEditorBridge(options: VisualEditorBridgeOptions) {
  const connected = ref(false);
  const readOnly = () => options.readOnly?.() ?? false;
  /** The frame's requests; edits are dropped while read-only, selection always passes. */
  const handlers = Object.fromEntries(
    Object.entries(options.on).map(([name, handler]) => [
      name,
      name === 'onSelectField'
        ? handler
        : (...args: unknown[]) => {
            if (!readOnly()) (handler as (...args: unknown[]) => void)(...args);
          },
    ]),
  ) as PreviewRequestHandlers;
  let channel: ReturnType<typeof createEditorChannel> | null = null;

  const target = () => options.target?.() ?? null;
  const previewOrigin = computed(() => {
    const own = target();
    if (own) return own.src ? (own.origin ?? '') : '';
    const url = options.siteUrl();
    if (!url) return '';
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  });
  const previewSrc = computed(() => {
    const own = target();
    if (own) return own.src ?? '';
    const url = options.siteUrl();
    return url ? `${url.replace(/\/$/, '')}/preview` : '';
  });

  function toPreviewDocument(): PreviewDocument | null {
    const doc = options.doc();
    const contentType = options.contentType();
    if (!doc || !contentType) return null;
    const fields = target()?.fields?.(doc.fields) ?? doc.fields;
    return {
      id: doc.id ?? null,
      typeId: doc.typeId,
      typeName: contentType.name,
      locale: doc.locale,
      title: doc.title,
      slug: doc.slug,
      permalink: null,
      // Frontend renderers key on block type names.
      fields: withBlockTypeNames(fields, (id) => options.typeById(id)?.name) as Record<
        string,
        unknown
      >,
    };
  }

  /** Sends the draft and its editing metadata; queued by the channel until the frame is ready. */
  function push(): void {
    const document = toPreviewDocument();
    const doc = options.doc();
    const contentType = options.contentType();
    if (!document || !doc || !contentType) return;
    const meta = {
      ...buildPreviewMeta(doc.fields, contentType, options.typeById, options.fieldTypeMeta),
      readOnly: readOnly(),
    };
    // Proxies cannot cross `postMessage`.
    const plain = plainClone({ document, meta });
    channel?.setDocument(plain.document, plain.meta);
  }

  /** The frame as a target's `ready` sees it; inert once its channel is gone. */
  function frameOf(own: ReturnType<typeof createEditorChannel>): AdminPreviewFrame {
    const live = () => channel === own;
    return {
      plugin: (id) => ({
        send: (name, payload) => {
          if (live()) own.plugin(id).send(name, payload);
        },
        on: (name, handler) => own.plugin(id).on(name, handler),
      }),
      document: () => (live() ? toPreviewDocument() : null),
      sync: () => {
        if (live()) push();
      },
    };
  }

  let frame: number | null = null;
  let highlightDue = false;
  /** Coalesces the edits of one frame into one push; a highlight made meanwhile follows it. */
  function schedule(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      push();
      if (highlightDue) highlight(options.highlighted());
      highlightDue = false;
    });
  }

  function highlight(path: FieldPath | null): void {
    channel?.highlight(path);
  }

  function disconnect(): void {
    channel?.destroy();
    channel = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    highlightDue = false;
    connected.value = false;
  }

  function connect(iframe: HTMLIFrameElement, origin: string): void {
    const own = createEditorChannel({
      iframe,
      previewOrigin: origin,
      onReady: () => {
        connected.value = true;
        target()?.ready?.(frameOf(own));
        push();
        own.highlight(options.highlighted());
      },
      ...handlers,
    });
    channel = own;
  }

  // The channel follows the iframe element and the space's origin.
  watch(
    () => [options.iframe.value, previewOrigin.value] as const,
    ([iframe, origin]) => {
      disconnect();
      if (iframe && origin) connect(iframe, origin);
    },
    { immediate: true, flush: 'post' },
  );
  onScopeDispose(disconnect);

  watch([options.revision, options.contentType, readOnly], schedule);
  watch(
    () => options.highlighted(),
    (path, previous) => {
      if (samePath(path, previous)) return;
      if (frame !== null) highlightDue = true;
      else highlight(path);
    },
  );

  return { connected, previewOrigin, previewSrc, push, highlight };
}
