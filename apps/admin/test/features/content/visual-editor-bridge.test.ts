import type { AdminPreviewFrame, AdminPreviewTarget } from '@manablox/admin-plugin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, markRaw, nextTick, ref } from 'vue';
import type { ContentRequestHandlers } from '~/features/content/useVisualEditorBridge';

vi.mock('@manablox/admin-sdk/lib/clone', async (actual) => {
  const real = await actual<typeof import('@manablox/admin-sdk/lib/clone')>();
  return { plainClone: vi.fn(real.plainClone) };
});

import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import type { ContentTypeSummary, FieldTypeMeta } from '@manablox/admin-sdk/lib/api-types';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import type { DraftDocument } from '~/features/content/useDraftStore';
import { useVisualEditorBridge } from '~/features/content/useVisualEditorBridge';

const SITE = 'http://site.test';

const pageType = {
  id: 'type-page',
  name: 'page',
  label: 'Page',
  fields: [
    {
      id: 'f-title',
      name: 'headline',
      label: 'Headline',
      type: 'string',
      settings: {},
      admin: { zone: 'main', position: 0 },
    },
  ],
} as unknown as ContentTypeSummary;

const makeDocument = (): DraftDocument => ({
  id: 'doc-1',
  spaceId: 'space-1',
  typeId: 'type-page',
  locale: 'en',
  parentId: null,
  title: 'Hello',
  slug: 'hello',
  fields: { headline: 'One' },
  position: 0,
  tags: [],
});

/** The channel checks the event source against the iframe window; a plain object must stay unproxied. */
function fakeIframe() {
  const contentWindow = { postMessage: vi.fn() };
  return { element: markRaw({ contentWindow }) as unknown as HTMLIFrameElement, contentWindow };
}

function fromFrame(source: unknown, data: unknown, origin = SITE) {
  window.dispatchEvent(
    new MessageEvent('message', { data, origin, source: source as MessageEventSource }),
  );
}

const handlers = () =>
  ({
    onMoveBlock: vi.fn(),
    onRemoveBlock: vi.fn(),
    onAddBlock: vi.fn(),
    onLayoutBlock: vi.fn(),
    onEditField: vi.fn(),
    onSelectField: vi.fn(),
    onRequestSave: vi.fn(),
  }) satisfies Required<ContentRequestHandlers>;

/** Animation frames run only when a test flushes them. */
let frames: FrameRequestCallback[] = [];
function flushFrames() {
  for (const callback of frames.splice(0)) callback(0);
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});

const scopes: (() => void)[] = [];
afterEach(() => {
  for (const stop of scopes.splice(0)) stop();
  vi.unstubAllGlobals();
  frames = [];
});

function setup(
  overrides: {
    siteUrl?: string | null;
    readOnly?: () => boolean;
    target?: () => AdminPreviewTarget | null;
  } = {},
) {
  const frame = fakeIframe();
  const iframe = ref<HTMLIFrameElement | null>(frame.element);
  const highlighted = ref<(string | number)[] | null>(null);
  const on = handlers();
  const scope = effectScope();
  const form = scope.run(() => useDraftForm<DraftDocument>())!;
  form.load(makeDocument());
  const doc = form.draft;
  const bridge = scope.run(() =>
    useVisualEditorBridge({
      iframe,
      siteUrl: () => (overrides.siteUrl === undefined ? `${SITE}/` : overrides.siteUrl),
      doc: () => doc.value,
      revision: () => form.revision.value,
      contentType: () => pageType,
      typeById: (id) => (id === pageType.id ? pageType : null),
      fieldTypeMeta: () => ({ nested: false, admin: {} }) as unknown as FieldTypeMeta,
      highlighted: () => highlighted.value,
      ...(overrides.readOnly ? { readOnly: overrides.readOnly } : {}),
      ...(overrides.target ? { target: overrides.target } : {}),
      on,
    }),
  )!;
  scopes.push(() => scope.stop());
  const ready = () =>
    fromFrame(frame.contentWindow, {
      v: 1,
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true },
    });
  return { bridge, frame, doc, highlighted, on, ready };
}

describe('useVisualEditorBridge', () => {
  it('derives the frame origin and preview URL from the site URL', () => {
    const { bridge } = setup();
    expect(bridge.previewOrigin.value).toBe(SITE);
    expect(bridge.previewSrc.value).toBe(`${SITE}/preview`);
    const none = setup({ siteUrl: null });
    expect(none.bridge.previewOrigin.value).toBe('');
    expect(none.bridge.previewSrc.value).toBe('');
  });

  it('connects on the ready handshake, then sends the document and the highlight', async () => {
    const { bridge, frame, highlighted, ready } = setup();
    await nextTick();
    highlighted.value = ['components', 0];
    expect(bridge.connected.value).toBe(false);
    ready();
    expect(bridge.connected.value).toBe(true);

    const sent = frame.contentWindow.postMessage.mock.calls.map(([message]) => message);
    expect(sent[0]).toMatchObject({
      v: 1,
      kind: 'document',
      document: { id: 'doc-1', typeName: 'page', title: 'Hello', fields: { headline: 'One' } },
      meta: { editable: { title: { kind: 'text' } } },
    });
    expect(sent[1]).toEqual({ v: 1, kind: 'highlight', path: ['components', 0] });
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[1]).toBe(SITE);
  });

  it('ignores messages from another origin or window', async () => {
    const { bridge, frame, on } = setup();
    await nextTick();
    fromFrame(frame.contentWindow, { v: 1, kind: 'ready', capabilities: {} }, 'http://evil.test');
    fromFrame({ other: true }, { v: 1, kind: 'ready', capabilities: {} });
    expect(bridge.connected.value).toBe(false);
    fromFrame(frame.contentWindow, { v: 1, kind: 'requestSave' });
    expect(on.onRequestSave).toHaveBeenCalledTimes(1);
  });

  it('pushes the document again when fields or the title change', async () => {
    const { frame, doc, ready } = setup();
    await nextTick();
    ready();
    frame.contentWindow.postMessage.mockClear();

    doc.value!.fields = { headline: 'Two' };
    await nextTick();
    flushFrames();
    expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[0]).toMatchObject({
      kind: 'document',
      document: { fields: { headline: 'Two' } },
    });

    doc.value!.title = 'Renamed';
    await nextTick();
    flushFrames();
    expect(frame.contentWindow.postMessage.mock.calls[1]?.[0]).toMatchObject({
      document: { title: 'Renamed' },
    });
  });

  it('coalesces the edits of one frame into one push with one clone', async () => {
    const { frame, doc, ready } = setup();
    await nextTick();
    ready();
    frame.contentWindow.postMessage.mockClear();
    vi.mocked(plainClone).mockClear();

    doc.value!.title = 'Renamed';
    doc.value!.fields = { headline: 'Two' };
    await nextTick();
    doc.value!.fields = { headline: 'Three' };
    await nextTick();
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    flushFrames();

    expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(plainClone).toHaveBeenCalledTimes(1);
    const [message] = frame.contentWindow.postMessage.mock.calls[0] ?? [];
    expect(message).toMatchObject({
      document: { title: 'Renamed', fields: { headline: 'Three' } },
    });
    // Structured-cloneable: no reactive proxies left.
    expect(() => structuredClone(message)).not.toThrow();
  });

  it('sends a highlight made while a push is pending after that push', async () => {
    const { frame, doc, highlighted, ready } = setup();
    await nextTick();
    ready();
    frame.contentWindow.postMessage.mockClear();

    doc.value!.fields = { headline: 'Two' };
    highlighted.value = ['components', 0];
    await nextTick();
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    flushFrames();
    const kinds = frame.contentWindow.postMessage.mock.calls.map(([m]) => m.kind);
    expect(kinds).toEqual(['document', 'highlight']);
  });

  it('highlights the selected block only when the path changes', async () => {
    const { frame, highlighted, ready } = setup();
    await nextTick();
    ready();
    frame.contentWindow.postMessage.mockClear();

    highlighted.value = ['components', 1];
    await nextTick();
    highlighted.value = ['components', 1];
    await nextTick();
    highlighted.value = null;
    await nextTick();
    const kinds = frame.contentWindow.postMessage.mock.calls.map(([m]) => m);
    expect(kinds).toEqual([
      { v: 1, kind: 'highlight', path: ['components', 1] },
      { v: 1, kind: 'highlight', path: null },
    ]);
  });

  it('relays block and field events from the frame to the handlers', async () => {
    const { frame, on, ready } = setup();
    await nextTick();
    ready();
    const send = (data: Record<string, unknown>) =>
      fromFrame(frame.contentWindow, { v: 1, ...data });

    send({ kind: 'moveBlock', list: ['components'], from: 0, to: 1 });
    expect(on.onMoveBlock).toHaveBeenCalledWith(['components'], 0, 1);
    send({ kind: 'removeBlock', list: ['components'], index: 2 });
    expect(on.onRemoveBlock).toHaveBeenCalledWith(['components'], 2);
    send({ kind: 'addBlock', list: ['components'], index: 1 });
    expect(on.onAddBlock).toHaveBeenCalledWith(['components'], 1);
    send({
      kind: 'layoutBlock',
      list: ['components'],
      index: 0,
      breakpoint: 'tablet',
      placement: null,
    });
    expect(on.onLayoutBlock).toHaveBeenCalledWith(['components'], 0, 'tablet', null);
    send({ kind: 'editField', path: ['title'], inline: 'text', text: 'Hi', html: '<p>Hi</p>' });
    expect(on.onEditField).toHaveBeenCalledWith(['title'], 'text', 'Hi', '<p>Hi</p>');
    send({ kind: 'selectField', path: ['components', 0, 'body'] });
    expect(on.onSelectField).toHaveBeenCalledWith(['components', 0, 'body']);
  });

  it('stops listening once the scope is disposed', async () => {
    const { bridge, frame, on, ready } = setup();
    await nextTick();
    ready();
    expect(bridge.connected.value).toBe(true);
    scopes.pop()?.();
    fromFrame(frame.contentWindow, { v: 1, kind: 'requestSave' });
    expect(on.onRequestSave).not.toHaveBeenCalled();
    expect(bridge.connected.value).toBe(false);
  });

  it('tells a read-only frame so and drops its edit requests', async () => {
    const readOnly = ref(true);
    const { frame, on, ready } = setup({ readOnly: () => readOnly.value });
    await nextTick();
    ready();
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[0]).toMatchObject({
      kind: 'document',
      meta: { readOnly: true },
    });

    fromFrame(frame.contentWindow, { v: 1, kind: 'removeBlock', list: ['body'], index: 0 });
    fromFrame(frame.contentWindow, {
      v: 1,
      kind: 'editField',
      path: ['headline'],
      inline: 'text',
      text: 'x',
      html: 'x',
    });
    fromFrame(frame.contentWindow, { v: 1, kind: 'requestSave' });
    fromFrame(frame.contentWindow, { v: 1, kind: 'selectField', path: ['headline'] });
    expect(on.onRemoveBlock).not.toHaveBeenCalled();
    expect(on.onEditField).not.toHaveBeenCalled();
    expect(on.onRequestSave).not.toHaveBeenCalled();
    expect(on.onSelectField).toHaveBeenCalledWith(['headline']);

    frame.contentWindow.postMessage.mockClear();
    readOnly.value = false;
    await nextTick();
    flushFrames();
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[0]).toMatchObject({
      meta: { readOnly: false },
    });
  });

  describe('with a plugin target', () => {
    const CANVAS = 'http://canvas.test';
    /** A content message's kind, a plugin message's name. */
    const nameOf = (message: { kind: string; name?: string }) =>
      message.kind === 'plugin' ? message.name : message.kind;
    const ready = (window: unknown) =>
      fromFrame(window, { v: 1, kind: 'ready', capabilities: { plugins: ['website'] } }, CANVAS);

    it("frames the target's page instead of the frontend preview", () => {
      const { bridge } = setup({
        target: () => ({ src: `${CANVAS}/_manablox/canvas`, origin: CANVAS }),
      });
      expect(bridge.previewOrigin.value).toBe(CANVAS);
      expect(bridge.previewSrc.value).toBe(`${CANVAS}/_manablox/canvas`);
      const empty = setup({ target: () => ({ src: null, origin: null, empty: 'No address.' }) });
      expect(empty.bridge.previewSrc.value).toBe('');
      const external = setup({ target: () => null });
      expect(external.bridge.previewSrc.value).toBe(`${SITE}/preview`);
    });

    it("hands the frame to the target's ready before the document goes out", async () => {
      let seen: AdminPreviewFrame | null = null;
      const { frame } = setup({
        target: () => ({
          src: `${CANVAS}/_manablox/canvas`,
          origin: CANVAS,
          ready: (next) => {
            seen = next;
            next.plugin('website').send('design', { title: next.document()?.title });
          },
        }),
      });
      await nextTick();
      ready(frame.contentWindow);

      const sent = () => frame.contentWindow.postMessage.mock.calls.map(([message]) => message);
      expect(sent().map(nameOf)).toEqual(['design', 'document', 'highlight']);
      expect(sent()[0]).toMatchObject({
        kind: 'plugin',
        plugin: 'website',
        name: 'design',
        payload: { title: 'Hello' },
      });
      expect(frame.contentWindow.postMessage.mock.calls[0]?.[1]).toBe(CANVAS);

      frame.contentWindow.postMessage.mockClear();
      (seen as AdminPreviewFrame | null)?.sync();
      expect(sent().map(nameOf)).toEqual(['document']);
    });

    it('renders the draft through the target field view, leaving the draft alone', async () => {
      const { frame, doc } = setup({
        target: () => ({
          src: `${CANVAS}/_manablox/canvas`,
          origin: CANVAS,
          fields: (fields) => ({ ...fields, headline: `${String(fields.headline)}!` }),
        }),
      });
      await nextTick();
      ready(frame.contentWindow);
      expect(frame.contentWindow.postMessage.mock.calls[0]?.[0]).toMatchObject({
        kind: 'document',
        document: { fields: { headline: 'One!' } },
      });
      expect(doc.value?.fields).toEqual({ headline: 'One' });
    });

    it('keeps an old frame inert once the frame is replaced', async () => {
      let seen: AdminPreviewFrame | null = null;
      const { frame } = setup({
        target: () => ({
          src: `${CANVAS}/_manablox/canvas`,
          origin: CANVAS,
          ready: (next) => {
            seen = next;
          },
        }),
      });
      await nextTick();
      ready(frame.contentWindow);
      scopes.pop()?.();
      frame.contentWindow.postMessage.mockClear();
      const old = seen as AdminPreviewFrame | null;
      old?.plugin('website').send('design', {});
      old?.sync();
      expect(old?.document()).toBeNull();
      expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    });
  });
});
