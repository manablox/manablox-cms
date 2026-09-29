import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorChannel } from '../src/editor.js';
import { connectPreview } from '../src/preview.js';
import {
  type EditorMessage,
  isEditorMessage,
  isPluginMessage,
  isPreviewMessage,
  PROTOCOL_VERSION,
  type PreviewMessage,
} from '../src/protocol.js';

const EDITOR_ORIGIN = 'https://admin.example';
const PREVIEW_ORIGIN = 'https://site.example';

interface Demo {
  toPreview: { show: { text: string }; clear: Record<string, never> };
  toEditor: { clicked: { id: string } };
}

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()?.();
});

function deliver(data: unknown, origin: string, source?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data, origin, source: source as MessageEventSource }),
  );
}

function editor() {
  const posted: EditorMessage[] = [];
  const contentWindow = { postMessage: (message: EditorMessage) => posted.push(message) };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  const onReady = vi.fn();
  const channel = createEditorChannel({ iframe, previewOrigin: PREVIEW_ORIGIN, onReady });
  teardown.push(channel.destroy);
  const fromFrame = (data: unknown, origin = PREVIEW_ORIGIN, source: unknown = contentWindow) =>
    deliver(data, origin, source);
  const ready = (plugins?: string[]) =>
    fromFrame({
      v: PROTOCOL_VERSION,
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true, ...(plugins ? { plugins } : {}) },
    } satisfies PreviewMessage);
  return { channel, posted, fromFrame, ready, onReady };
}

const plugin = (name: string, payload: unknown, id = 'demo') => ({
  v: PROTOCOL_VERSION,
  kind: 'plugin' as const,
  plugin: id,
  name,
  payload,
});

describe('protocol version 1', () => {
  it('accepts content and plugin messages at version 1 only', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(isEditorMessage({ v: 1, kind: 'document' })).toBe(true);
    expect(isEditorMessage({ v: 1, kind: 'plugin' })).toBe(true);
    expect(isEditorMessage({ v: 2, kind: 'document' })).toBe(false);
    expect(isPreviewMessage({ v: 2, kind: 'selectField' })).toBe(false);
    expect(isPluginMessage(plugin('show', {}))).toBe(true);
    expect(isPluginMessage({ ...plugin('show', {}), v: 2 })).toBe(false);
    expect(isPluginMessage({ v: 1, kind: 'plugin', plugin: 'demo' })).toBe(false);
  });
});

describe('editor plugin channel', () => {
  it('queues the last payload per name until ready, in first-send order, before the document', () => {
    const { channel, posted, ready, onReady } = editor();
    const demo = channel.plugin<Demo>('demo');
    demo.send('show', { text: 'a' });
    demo.send('clear', {});
    demo.send('show', { text: 'b' });
    channel.setDocument({
      id: null,
      typeId: 't',
      typeName: 't',
      locale: 'en',
      title: '',
      slug: '',
      permalink: null,
      fields: {},
    });
    expect(posted).toEqual([]);
    ready(['demo']);
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ plugins: ['demo'] }));
    expect(posted.map((message) => message.kind)).toEqual(['plugin', 'plugin', 'document']);
    expect(posted.slice(0, 2)).toEqual([plugin('show', { text: 'b' }), plugin('clear', {})]);
    demo.send('show', { text: 'c' });
    expect(posted.at(-1)).toEqual(plugin('show', { text: 'c' }));
  });

  it('drops messages for a plugin the frame did not list', () => {
    const { channel, posted, ready } = editor();
    channel.plugin('other').send('show', { text: 'queued' });
    ready(['demo']);
    channel.plugin('other').send('show', { text: 'late' });
    expect(posted).toEqual([]);
  });

  it('drops every plugin message for a frame without plugins', () => {
    const { channel, posted, ready } = editor();
    ready();
    channel.plugin('demo').send('show', { text: 'x' });
    expect(posted).toEqual([]);
  });

  it('hands messages from its own frame and origin to the handlers of that plugin and name', () => {
    const { channel, fromFrame } = editor();
    const seen: unknown[] = [];
    const off = channel.plugin<Demo>('demo').on('clicked', (payload) => seen.push(payload.id));
    channel.plugin('else').on('clicked', () => seen.push('wrong plugin'));
    fromFrame(plugin('clicked', { id: 'a' }));
    fromFrame(plugin('clicked', { id: 'evil' }), 'https://evil.example');
    fromFrame(plugin('clicked', { id: 'stranger' }), PREVIEW_ORIGIN, {});
    fromFrame(plugin('other', { id: 'name' }));
    fromFrame({ ...plugin('clicked', { id: 'v2' }), v: 2 });
    off();
    fromFrame(plugin('clicked', { id: 'after' }));
    expect(seen).toEqual(['a']);
  });

  it('ignores a kind it does not handle', () => {
    const { fromFrame } = editor();
    expect(() => fromFrame({ v: 1, kind: 'selectNode', node: 'page:p:a' })).not.toThrow();
  });
});

describe('preview plugin channel', () => {
  function preview(plugins?: string[]) {
    const posted: PreviewMessage[] = [];
    const connection = connectPreview({
      editorOrigin: EDITOR_ORIGIN,
      onDocument: vi.fn(),
      post: (message) => posted.push(message),
      ...(plugins ? { plugins } : {}),
    });
    teardown.push(connection);
    return { connection, posted };
  }

  it('lists its plugins in the handshake and stays callable as the disconnect function', () => {
    const { connection, posted } = preview(['demo']);
    expect(posted[0]).toEqual({
      v: 1,
      kind: 'ready',
      capabilities: { fields: false, blocks: false, inline: false, plugins: ['demo'] },
    });
    expect(typeof connection).toBe('function');
    expect(preview().posted[0]).toMatchObject({ capabilities: { fields: false } });
    expect(preview().posted[0]).not.toHaveProperty('capabilities.plugins');
  });

  it('sends to the editor and receives from the editor origin only', () => {
    const { connection, posted } = preview(['demo']);
    const demo = connection.plugin<Demo>('demo');
    demo.send('clicked', { id: 'x' });
    expect(posted.at(-1)).toEqual(plugin('clicked', { id: 'x' }));

    const seen: string[] = [];
    demo.on('show', (payload) => seen.push(payload.text));
    deliver(plugin('show', { text: 'ok' }), EDITOR_ORIGIN);
    deliver(plugin('show', { text: 'evil' }), 'https://evil.example');
    deliver(plugin('show', { text: 'other' }, 'other'), EDITOR_ORIGIN);
    deliver({ ...plugin('show', { text: 'v2' }), v: 2 }, EDITOR_ORIGIN);
    expect(seen).toEqual(['ok']);
  });

  it('applies content messages next to plugin ones', () => {
    const onDocument = vi.fn();
    const connection = connectPreview({
      editorOrigin: EDITOR_ORIGIN,
      onDocument,
      post: () => {},
      plugins: ['demo'],
    });
    teardown.push(connection);
    deliver(
      {
        v: PROTOCOL_VERSION,
        kind: 'document',
        document: { id: 'd' },
        meta: { editable: {}, labels: {}, grids: {} },
      },
      EDITOR_ORIGIN,
    );
    expect(onDocument).toHaveBeenCalledOnce();
  });
});
