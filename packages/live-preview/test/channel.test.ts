import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorChannel } from '../src/editor.js';
import { connectPreview } from '../src/preview.js';
import {
  type EditorMessage,
  PROTOCOL_VERSION,
  type PreviewDocument,
  type PreviewMessage,
  type PreviewMeta,
} from '../src/protocol.js';

/**
 * Both channel halves in one document. happy-dom's `postMessage` does not cross realms,
 * so messages are delivered to listeners by hand.
 */

const EDITOR_ORIGIN = 'https://admin.example';
const PREVIEW_ORIGIN = 'https://site.example';

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
const META: PreviewMeta = { editable: {}, labels: {}, grids: {} };

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()?.();
  vi.restoreAllMocks();
});

/** Delivers a message to `window`'s listeners as if it had arrived from `origin`. */
function deliver(data: unknown, origin: string, source?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data, origin, source: source as MessageEventSource }),
  );
}

/** An iframe whose stub `contentWindow` records what is posted to it. */
function fakeFrame() {
  const posted: EditorMessage[] = [];
  const contentWindow = {
    postMessage: (message: EditorMessage, origin: string) => {
      expect(origin).toBe(PREVIEW_ORIGIN);
      posted.push(message);
    },
  };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  return { iframe, posted, contentWindow };
}

describe('editor channel', () => {
  it('ignores a message from any origin but the preview', () => {
    const onReady = vi.fn();
    const { iframe, contentWindow } = fakeFrame();
    const channel = createEditorChannel({ iframe, previewOrigin: PREVIEW_ORIGIN, onReady });
    teardown.push(channel.destroy);

    const ready: PreviewMessage = {
      v: PROTOCOL_VERSION,
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true },
    };
    deliver(ready, 'https://evil.example', contentWindow);
    expect(onReady).not.toHaveBeenCalled();

    deliver(ready, PREVIEW_ORIGIN, contentWindow);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('ignores a message from a window that is not its own frame', () => {
    const onReady = vi.fn();
    const { iframe, contentWindow } = fakeFrame();
    const channel = createEditorChannel({ iframe, previewOrigin: PREVIEW_ORIGIN, onReady });
    teardown.push(channel.destroy);

    const ready: PreviewMessage = {
      v: PROTOCOL_VERSION,
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true },
    };
    deliver(ready, PREVIEW_ORIGIN, { other: true });
    expect(onReady).not.toHaveBeenCalled();

    deliver(ready, PREVIEW_ORIGIN, contentWindow);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('holds a document sent before the frame is ready and replays it on ready', () => {
    const { iframe, posted, contentWindow } = fakeFrame();
    const channel = createEditorChannel({ iframe, previewOrigin: PREVIEW_ORIGIN });
    teardown.push(channel.destroy);

    channel.setDocument(DOCUMENT, META);
    expect(posted).toHaveLength(0);

    deliver(
      {
        v: PROTOCOL_VERSION,
        kind: 'ready',
        capabilities: { fields: true, blocks: true, inline: true },
      } satisfies PreviewMessage,
      PREVIEW_ORIGIN,
      contentWindow,
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: 'document', document: DOCUMENT });
    // Replayed only once.
    deliver(
      {
        v: PROTOCOL_VERSION,
        kind: 'ready',
        capabilities: { fields: true, blocks: true, inline: true },
      } satisfies PreviewMessage,
      PREVIEW_ORIGIN,
      contentWindow,
    );
    expect(posted).toHaveLength(1);
  });

  it('routes each preview message to its callback', () => {
    const calls: string[] = [];
    const { iframe, contentWindow } = fakeFrame();
    const channel = createEditorChannel({
      iframe,
      previewOrigin: PREVIEW_ORIGIN,
      onMoveBlock: (list, from, to) => calls.push(`move ${list.join('.')} ${from}->${to}`),
      onRemoveBlock: (list, index) => calls.push(`remove ${list.join('.')} ${index}`),
      onAddBlock: (list, index) => calls.push(`add ${list.join('.')} ${index}`),
      onEditField: (path, inline, text) => calls.push(`edit ${path.join('.')} ${inline} ${text}`),
      onSelectField: (path) => calls.push(`select ${path.join('.')}`),
      onRequestSave: () => calls.push('save'),
    });
    teardown.push(channel.destroy);

    const messages: PreviewMessage[] = [
      { v: PROTOCOL_VERSION, kind: 'moveBlock', list: ['body'], from: 0, to: 2 },
      { v: PROTOCOL_VERSION, kind: 'removeBlock', list: ['body'], index: 1 },
      { v: PROTOCOL_VERSION, kind: 'addBlock', list: ['body'], index: 3 },
      {
        v: PROTOCOL_VERSION,
        kind: 'editField',
        path: ['title'],
        inline: 'text',
        text: 'Hi',
        html: 'Hi',
      },
      { v: PROTOCOL_VERSION, kind: 'selectField', path: ['title'] },
      { v: PROTOCOL_VERSION, kind: 'requestSave' },
    ];
    for (const message of messages) deliver(message, PREVIEW_ORIGIN, contentWindow);

    expect(calls).toEqual([
      'move body 0->2',
      'remove body 1',
      'add body 3',
      'edit title text Hi',
      'select title',
      'save',
    ]);
  });

  it('stops listening once destroyed', () => {
    const onReady = vi.fn();
    const { iframe, contentWindow } = fakeFrame();
    const channel = createEditorChannel({ iframe, previewOrigin: PREVIEW_ORIGIN, onReady });
    channel.destroy();

    deliver(
      {
        v: PROTOCOL_VERSION,
        kind: 'ready',
        capabilities: { fields: true, blocks: true, inline: true },
      } satisfies PreviewMessage,
      PREVIEW_ORIGIN,
      contentWindow,
    );
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('preview channel', () => {
  /** `connectPreview` returns a no-op unless it believes it is framed. */
  function asFramed(): PreviewMessage[] {
    const posted: PreviewMessage[] = [];
    vi.spyOn(window, 'parent', 'get').mockReturnValue({
      postMessage: (message: PreviewMessage, origin: string) => {
        expect(origin).toBe(EDITOR_ORIGIN);
        posted.push(message);
      },
    } as unknown as Window);
    return posted;
  }

  it('does nothing at all when it is not in a frame', () => {
    const onDocument = vi.fn();
    // `window.parent === window` in a top-level document.
    const stop = connectPreview({ editorOrigin: EDITOR_ORIGIN, onDocument });
    stop();
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('announces its capabilities as soon as it connects', () => {
    const posted = asFramed();
    const stop = connectPreview({
      editorOrigin: EDITOR_ORIGIN,
      onDocument: () => {},
      clickToEdit: true,
    });
    teardown.push(stop);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true },
    });
  });

  it('refuses a document from any origin but the editor', () => {
    asFramed();
    const onDocument = vi.fn();
    const stop = connectPreview({ editorOrigin: EDITOR_ORIGIN, onDocument });
    teardown.push(stop);

    const message: EditorMessage = {
      v: PROTOCOL_VERSION,
      kind: 'document',
      document: DOCUMENT,
      meta: META,
    };
    deliver(message, 'https://evil.example');
    expect(onDocument).not.toHaveBeenCalled();

    deliver(message, EDITOR_ORIGIN);
    expect(onDocument).toHaveBeenCalledWith(DOCUMENT, META);
  });

  it('refuses a message that does not carry the protocol version', () => {
    asFramed();
    const onDocument = vi.fn();
    const stop = connectPreview({ editorOrigin: EDITOR_ORIGIN, onDocument });
    teardown.push(stop);

    deliver({ kind: 'document', document: DOCUMENT, meta: META }, EDITOR_ORIGIN);
    deliver({ v: 2, kind: 'document', document: DOCUMENT, meta: META }, EDITOR_ORIGIN);
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('passes a highlight through and stops on teardown', () => {
    asFramed();
    const onHighlight = vi.fn();
    const stop = connectPreview({
      editorOrigin: EDITOR_ORIGIN,
      onDocument: () => {},
      onHighlight,
    });

    deliver(
      { v: PROTOCOL_VERSION, kind: 'highlight', path: ['title'] } satisfies EditorMessage,
      EDITOR_ORIGIN,
    );
    expect(onHighlight).toHaveBeenCalledWith(['title']);

    stop();
    deliver(
      { v: PROTOCOL_VERSION, kind: 'highlight', path: null } satisfies EditorMessage,
      EDITOR_ORIGIN,
    );
    expect(onHighlight).toHaveBeenCalledOnce();
  });
});
