// @vitest-environment happy-dom
import type { PreviewMessage } from '@manablox/live-preview';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { type Canvas, mountCanvas } from '../src/canvas/index.js';
import { renderCanvasPage } from '../src/canvas-page.js';
import { pageWith, renderInput } from './fixtures.js';
import { bareLayout } from './helpers.js';

const EDITOR = 'https://admin.test';
let canvas: Canvas | null = null;

afterEach(() => {
  canvas?.destroy();
  canvas = null;
  document.body.innerHTML = '';
});

const page = pageWith(
  { id: 'hello', el: 'text', props: { text: { en: 'Hello' } } },
  { id: 'bound', el: 'text', bind: { field: 'f-intro' } },
  {
    id: 'box',
    el: 'box',
    children: [{ id: 'inner', el: 'heading', props: { text: { en: 'Inner' } } }],
  },
);

async function setup(
  focus: { kind: 'page'; key: string } | null = { kind: 'page', key: 't-page' },
) {
  const posted: PreviewMessage[] = [];
  const el = document.createElement('div');
  document.body.appendChild(el);
  canvas = mountCanvas(el, {
    editorOrigin: EDITOR,
    post: (message) => posted.push(message),
    initial: { input: renderInput({ page, layout: bareLayout }), css: '.x{color:red}', focus },
  });
  await nextTick();
  return { posted, el };
}

const node = (ref: string) =>
  document.querySelector<HTMLElement>(`[data-mb-node="${ref}"]`) as HTMLElement;

function fromEditor(data: unknown, origin = EDITOR) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

const toEditor = (name: string, payload: unknown) => ({
  v: 1,
  kind: 'plugin',
  plugin: 'website',
  name,
  payload,
});
const toCanvas = toEditor;

describe('canvas', () => {
  it('announces itself, renders the design and injects its CSS', async () => {
    const { posted } = await setup();
    expect(posted[0]).toEqual({
      v: 1,
      kind: 'ready',
      capabilities: { fields: true, blocks: true, inline: true, plugins: ['website'] },
    });
    expect(node('page:t-page:hello').textContent).toBe('Hello');
    expect(document.getElementById('mb-canvas-css')?.textContent).toBe('.x{color:red}');
  });

  it('selects nodes on click and removes the selection with Delete', async () => {
    const { posted } = await setup();
    node('page:t-page:inner').click();
    expect(posted.at(-1)).toEqual(toEditor('selectNode', { node: 'page:t-page:inner' }));
    expect(canvas?.selected()).toBe('page:t-page:inner');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(posted.at(-1)).toEqual(toEditor('removeNode', { node: 'page:t-page:inner' }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(posted.at(-1)).toEqual(toEditor('selectNode', { node: null }));
  });

  it('edits static text in place, and not bound text', async () => {
    const { posted } = await setup();
    const hello = node('page:t-page:hello');
    hello.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(hello.getAttribute('contenteditable')).toBe('true');
    hello.textContent = 'Hi there';
    hello.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(hello.hasAttribute('contenteditable')).toBe(false);
    expect(posted.at(-1)).toEqual(
      toEditor('editText', {
        node: 'page:t-page:hello',
        text: 'Hi there',
        locale: 'en',
        field: null,
      }),
    );
    const bound = node('page:t-page:bound');
    bound.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(bound.hasAttribute('contenteditable')).toBe(false);
  });

  it('cancels an edit with Escape', async () => {
    const { posted } = await setup();
    const hello = node('page:t-page:hello');
    hello.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    hello.textContent = 'Changed';
    const count = posted.length;
    hello.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hello.textContent).toBe('Hello');
    expect(posted.length).toBe(count);
  });

  it('reports a resize in pixels', async () => {
    const { posted } = await setup();
    node('page:t-page:box').click();
    const handle = document.querySelector('.mb-canvas-ui-resize') as HTMLElement;
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 130, clientY: 60, bubbles: true }),
    );
    expect(posted.at(-1)).toEqual(
      toEditor('resizeNode', { node: 'page:t-page:box', width: 120, height: 50 }),
    );
  });

  it('re-renders on design messages from the editor origin only', async () => {
    await setup();
    const next = renderInput({
      page: pageWith({ id: 'hello', el: 'text', props: { text: { en: 'Updated' } } }),
      layout: bareLayout,
    });
    const design = { input: next, css: '.y{}', focus: { kind: 'page', key: 't-page' } };
    fromEditor(toCanvas('design', design), 'https://evil.test');
    fromEditor({ ...toCanvas('design', design), v: 2 });
    await nextTick();
    expect(node('page:t-page:hello').textContent).toBe('Hello');
    fromEditor(toCanvas('design', design));
    await nextTick();
    expect(node('page:t-page:hello').textContent).toBe('Updated');
    expect(document.getElementById('mb-canvas-css')?.textContent).toBe('.y{}');
    fromEditor(toCanvas('breakpoint', { breakpoint: 'mobile' }));
    expect(document.documentElement.getAttribute('data-mb-breakpoint')).toBe('mobile');
    fromEditor(toCanvas('scheme', { scheme: 'dark' }));
    expect(document.documentElement.getAttribute('data-mb-scheme')).toBe('dark');
    fromEditor(toCanvas('scheme', { scheme: 'sepia' }));
    fromEditor(toCanvas('scheme', null));
    expect(document.documentElement.getAttribute('data-mb-scheme')).toBe('dark');
  });

  it('holds a design that arrives while text is edited', async () => {
    await setup();
    const hello = node('page:t-page:hello');
    hello.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const next = renderInput({
      page: pageWith({ id: 'hello', el: 'text', props: { text: { en: 'Updated' } } }),
      layout: bareLayout,
    });
    fromEditor(
      toCanvas('design', { input: next, css: '', focus: { kind: 'page', key: 't-page' } }),
    );
    await nextTick();
    expect(node('page:t-page:hello').textContent).toBe('Hello');
    hello.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(node('page:t-page:hello').textContent).toBe('Updated');
  });

  it('only selects in design mode, and keeps links from navigating', async () => {
    const { posted } = await setup(null);
    const count = posted.length;
    node('page:t-page:hello').click();
    expect(posted.length).toBe(count);
    const link = document.createElement('a');
    link.href = 'https://elsewhere.test';
    document.body.appendChild(link);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens menus with their toggle, also after a re-render', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const input = renderInput({ page });
    canvas = mountCanvas(el, {
      editorOrigin: EDITOR,
      post: () => {},
      initial: { input, focus: { kind: 'page', key: 't-page' } },
    });
    await nextTick();
    await nextTick();
    const toggle = () => el.querySelector<HTMLButtonElement>('.mb-menu-toggle') as HTMLElement;
    toggle().click();
    expect(el.querySelector('nav.mb-menu')?.hasAttribute('data-open')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    toggle().click();
    expect(el.querySelector('nav.mb-menu')?.hasAttribute('data-open')).toBe(false);

    canvas.setDesign({ input: { ...input, locale: 'de' }, focus: null });
    await nextTick();
    await nextTick();
    toggle().click();
    expect(el.querySelector('nav.mb-menu')?.hasAttribute('data-open')).toBe(true);
  });

  it('ignores edits when read-only', async () => {
    const { posted } = await setup();
    canvas?.setDesign({
      input: renderInput({ page, layout: bareLayout }),
      focus: { kind: 'page', key: 't-page' },
      readOnly: true,
    });
    await nextTick();
    node('page:t-page:hello').click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(posted.at(-1)).toEqual(toEditor('selectNode', { node: 'page:t-page:hello' }));
  });
});

describe('renderCanvasPage', () => {
  it('serves a shell that loads the bundle with its config', () => {
    const html = renderCanvasPage({
      scriptSrc: '/_site/canvas.abc.js',
      editorOrigin: 'https://a.test</script>',
    });
    expect(html).toContain('<script type="module" src="/_site/canvas.abc.js"></script>');
    expect(html).toContain('"editorOrigin":"https://a.test\\u003c/script>"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});
