import { afterEach, describe, expect, it } from 'vitest';
import {
  beginGrid,
  beginReorder,
  commitDrag,
  draggedPath,
  moveDrag,
} from '../src/controls/drag.js';
import {
  type Area,
  areaOf,
  blockOf,
  cellAt,
  clampArea,
  geometryOf,
  indexOf,
  labelFor,
  listElements,
  listOf,
  siblingsOf,
} from '../src/controls/hit-test.js';
import { mountBlockControls } from '../src/controls.js';
import { placeBar } from '../src/dom.js';
import { PROTOCOL_VERSION, type PreviewMessage, type PreviewMeta } from '../src/protocol.js';

/** The block controls' drag arithmetic: reorder gaps, grid clamping, and no-op gestures. */

const META: PreviewMeta = { editable: {}, labels: {}, grids: {} };

/** Unwraps a value the test expects to exist. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Stubs an element's box, since happy-dom has no layout. */
function at(element: HTMLElement, top: number, left: number, width = 100, height = 40) {
  element.getBoundingClientRect = () => new DOMRect(left, top, width, height) as unknown as DOMRect;
  return element;
}

function block(path: string, top: number, left: number): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-manablox-field', path);
  document.body.appendChild(element);
  return at(element, top, left);
}

function list(path: string, style?: Partial<CSSStyleDeclaration>): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-manablox-list', path);
  if (style) Object.assign(element.style, style);
  document.body.appendChild(element);
  return at(element, 0, 0, 320, 200);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('reading the page', () => {
  it('finds the block an event happened inside, not the field within it', () => {
    const outer = block('body.0', 0, 0);
    const text = document.createElement('span');
    text.setAttribute('data-manablox-field', 'body.0.title');
    outer.appendChild(text);

    expect(blockOf(text)).toEqual(['body', 0]);
    expect(blockOf(outer)).toEqual(['body', 0]);
    expect(blockOf(document.body)).toBe(null);
  });

  it('orders a list by index rather than by document order', () => {
    block('body.2', 0, 0);
    block('body.0', 0, 0);
    block('body.10', 0, 0);
    block('body.1', 0, 0);
    // A field of a block is not a sibling of it.
    block('body.0.title', 0, 0);

    expect(siblingsOf(['body']).map((el) => el.getAttribute('data-manablox-field'))).toEqual([
      'body.0',
      'body.1',
      'body.2',
      'body.10',
    ]);
  });

  it('names a block, and counts it only when it has neighbours', () => {
    const meta: PreviewMeta = { ...META, labels: { 'body.0': 'Hero', 'body.1': 'Hero' } };
    block('body.0', 0, 0);
    expect(labelFor(meta, ['body', 0])).toBe('Hero');
    block('body.1', 0, 0);
    expect(labelFor(meta, ['body', 0])).toBe('Hero - 1/2');
    expect(labelFor(meta, ['body', 1])).toBe('Hero - 2/2');
    expect(labelFor(META, ['body', 0])).toBe('Block - 1/2');
  });

  it('lists every tagged list, empty or not', () => {
    list('body');
    list('aside');
    expect(
      listElements()
        .map((entry) => entry.raw)
        .sort(),
    ).toEqual(['aside', 'body']);
  });

  it('takes a path apart the way the toolbar does', () => {
    expect(listOf(['body', 3])).toEqual(['body']);
    expect(indexOf(['body', 3])).toBe(3);
    expect(indexOf(['body'])).toBe(-1);
  });
});

describe('a plain list', () => {
  it('is not a grid, so a grid drag cannot begin on it', () => {
    list('body');
    block('body.0', 0, 0);
    expect(geometryOf(META, ['body'])).toBe(null);
    expect(beginGrid(META, ['body', 0], 'move', null, 10, 10)).toBe(null);
  });

  it('reports the gap a block was dropped in, counted after it leaves', () => {
    block('body.0', 0, 0);
    block('body.1', 60, 0);
    block('body.2', 120, 0);
    const drag = beginReorder(['body', 0]);
    expect(draggedPath(drag)).toEqual(['body', 0]);

    // The last gap lands one index lower: the carried block is out of the list.
    moveDrag(drag, META, 50, 165);
    expect(commitDrag(drag)).toEqual({
      v: PROTOCOL_VERSION,
      kind: 'moveBlock',
      list: ['body'],
      from: 0,
      to: 2,
    });
  });

  it('says nothing when the block is dropped where it started', () => {
    block('body.0', 0, 0);
    block('body.1', 60, 0);
    const drag = beginReorder(['body', 1]);
    // The gaps on either side of the block are no-ops.
    moveDrag(drag, META, 50, 95);
    expect(commitDrag(drag)).toBe(null);
    moveDrag(drag, META, 50, 65);
    expect(commitDrag(drag)).toBe(null);
  });

  it('says nothing when the pointer never moved', () => {
    expect(commitDrag(beginReorder(['body', 0]))).toBe(null);
  });
});

describe('a grid', () => {
  const grid = (columns = 3, rows?: number): PreviewMeta => ({
    ...META,
    grids: {
      body: {
        desktop: { columns, rows },
        tablet: { columns, rows },
        mobile: { columns, rows },
      },
    },
  });

  function threeByTwo() {
    const element = list('body', {
      display: 'grid',
      gridTemplateColumns: '100px 100px 100px',
      gridTemplateRows: '40px 40px',
      columnGap: '10px',
      rowGap: '10px',
    });
    return element;
  }

  it('reads the tracks off the page and the block off the tracks', () => {
    threeByTwo();
    const geometry = must(geometryOf(grid(), ['body']));
    expect(geometry.columns).toHaveLength(3);
    expect(geometry.rows).toHaveLength(2);
    expect(areaOf(geometry, new DOMRect(0, 0, 100, 40))).toEqual({
      column: 1,
      row: 1,
      columnSpan: 1,
      rowSpan: 1,
    });
    // Two columns wide, from the second track.
    expect(areaOf(geometry, new DOMRect(110, 0, 210, 40))).toEqual({
      column: 2,
      row: 1,
      columnSpan: 2,
      rowSpan: 1,
    });
    expect(cellAt(geometry, 230, 5)).toEqual({ column: 3, row: 1 });
  });

  it('keeps a block on the grid the editor declared', () => {
    threeByTwo();
    const geometry = must(geometryOf(grid(3, 2), ['body']));
    const wide: Area = { column: 3, row: 1, columnSpan: 3, rowSpan: 1 };
    // Three wide cannot start in the third column.
    expect(clampArea(grid(3, 2), ['body'], geometry, wide)).toEqual({
      column: 1,
      row: 1,
      columnSpan: 3,
      rowSpan: 1,
    });
    // A fixed row count stops at the last row.
    expect(
      clampArea(grid(3, 2), ['body'], geometry, {
        column: 1,
        row: 4,
        columnSpan: 1,
        rowSpan: 1,
      }).row,
    ).toBe(2);
    // A growing grid does not.
    expect(
      clampArea(grid(3), ['body'], geometry, { column: 1, row: 4, columnSpan: 1, rowSpan: 1 }).row,
    ).toBe(4);
  });

  it('moves a block by the cells the pointer crossed', () => {
    threeByTwo();
    const meta = grid(3, 2);
    at(block('body.0', 0, 0), 0, 0);
    const drag = must(beginGrid(meta, ['body', 0], 'move', null, 50, 20));
    expect(drag.mode).toBe('move');

    // Two columns to the right, one row down.
    moveDrag(drag, meta, 270, 70);
    expect(commitDrag(drag)).toEqual({
      v: PROTOCOL_VERSION,
      kind: 'layoutBlock',
      list: ['body'],
      index: 0,
      breakpoint: 'desktop',
      placement: { column: 3, row: 2, columnSpan: 1, rowSpan: 1 },
    });
  });

  it('resizes only along the edge that was grabbed', () => {
    threeByTwo();
    const meta = grid(3, 2);
    at(block('body.0', 0, 0), 0, 0);

    const east = must(beginGrid(meta, ['body', 0], 'resize', 'e', 50, 20));
    moveDrag(east, meta, 270, 70);
    expect(commitDrag(east)).toMatchObject({
      placement: { column: 1, row: 1, columnSpan: 3, rowSpan: 1 },
    });

    const south = must(beginGrid(meta, ['body', 0], 'resize', 's', 50, 20));
    moveDrag(south, meta, 270, 70);
    expect(commitDrag(south)).toMatchObject({
      placement: { column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
    });
  });

  it('says nothing when the block ends where it began', () => {
    threeByTwo();
    const meta = grid(3, 2);
    at(block('body.0', 0, 0), 0, 0);
    const drag = must(beginGrid(meta, ['body', 0], 'move', null, 50, 20));
    moveDrag(drag, meta, 55, 25);
    expect(commitDrag(drag)).toBe(null);
  });
});

describe('a floating bar', () => {
  function bar(width: number, height: number) {
    const element = document.createElement('div');
    Object.defineProperty(element, 'offsetWidth', { value: width });
    Object.defineProperty(element, 'offsetHeight', { value: height });
    return element;
  }

  it('sits above the rectangle when there is room, right-aligned for a block', () => {
    const element = bar(120, 30);
    placeBar(element, new DOMRect(200, 100, 300, 80), {
      gap: 6,
      fallback: 'inside',
      align: 'end',
    });
    expect(element.style.top).toBe('64px');
    expect(element.style.left).toBe('376px');
  });

  it('drops inside the rectangle when the page is scrolled to its top', () => {
    const element = bar(120, 30);
    placeBar(element, new DOMRect(0, 0, 300, 80), { gap: 6, fallback: 'inside', align: 'end' });
    expect(element.style.top).toBe('4px');
  });

  it('drops below the rectangle for a line of text, left-aligned', () => {
    const element = bar(120, 30);
    placeBar(element, new DOMRect(40, 10, 200, 20), {
      gap: 8,
      fallback: 'below',
      align: 'start',
    });
    expect(element.style.top).toBe('38px');
    expect(element.style.left).toBe('40px');
  });

  it('never leaves the viewport', () => {
    const element = bar(120, 30);
    placeBar(element, new DOMRect(window.innerWidth - 10, 400, 300, 80), {
      gap: 6,
      fallback: 'inside',
      align: 'end',
    });
    expect(Number.parseFloat(element.style.left)).toBeLessThanOrEqual(window.innerWidth - 120 - 4);
    expect(Number.parseFloat(element.style.left)).toBeGreaterThanOrEqual(4);
  });
});

describe('the mounted toolbar', () => {
  const mounted: Array<() => void> = [];

  afterEach(() => {
    while (mounted.length) mounted.pop()?.();
  });

  /** Waits for the overlay's animation frame. */
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function mount() {
    const posted: PreviewMessage[] = [];
    const controls = mountBlockControls({ post: (message) => posted.push(message) });
    mounted.push(controls.destroy);
    return { controls, posted };
  }

  it('draws a toolbar over the block the pointer is on', async () => {
    const element = block('body.0', 40, 20);
    block('body.1', 100, 20);
    const { controls } = mount();
    controls.setMeta({ editable: {}, labels: { 'body.0': 'Hero' }, grids: {} });

    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await frame();

    const bar = document.querySelector('[role="toolbar"][aria-label="Block"]');
    expect(bar).not.toBeNull();
    expect(
      [...(bar as HTMLElement).querySelectorAll('button')].map((b) => b.dataset.action),
    ).toEqual(['drag', 'up', 'down', 'add', 'delete']);
    expect(document.body.textContent).toContain('Hero - 1/2');
    // The first block of a list cannot move up.
    expect(
      (bar as HTMLElement).querySelector<HTMLButtonElement>('[data-action="up"]')?.disabled,
    ).toBe(true);
    expect(
      (bar as HTMLElement).querySelector<HTMLButtonElement>('[data-action="down"]')?.disabled,
    ).toBe(false);
    expect(controls.owns(bar)).toBe(true);
    expect(controls.owns(element)).toBe(false);
  });

  it('posts what its buttons say', async () => {
    const element = block('body.1', 40, 20);
    block('body.0', 0, 20);
    const { posted } = mount();
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await frame();

    const bar = document.querySelector('[role="toolbar"]') as HTMLElement;
    bar.querySelector<HTMLButtonElement>('[data-action="up"]')?.click();
    bar.querySelector<HTMLButtonElement>('[data-action="add"]')?.click();
    bar.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();

    expect(posted).toEqual([
      { v: PROTOCOL_VERSION, kind: 'moveBlock', list: ['body'], from: 1, to: 0 },
      { v: PROTOCOL_VERSION, kind: 'addBlock', list: ['body'], index: 2 },
      { v: PROTOCOL_VERSION, kind: 'removeBlock', list: ['body'], index: 1 },
    ]);
  });

  it('offers an empty list somewhere to start', async () => {
    list('body');
    const { posted } = mount();
    await frame();

    const adder = document.querySelector('button.manablox-controls-add') as HTMLElement;
    expect(adder?.textContent).toContain('Add a block');
    adder.click();
    expect(posted).toEqual([{ v: PROTOCOL_VERSION, kind: 'addBlock', list: ['body'], index: 0 }]);
  });

  it('shows no toolbar, adders or actions for a read-only viewer', async () => {
    const element = block('body.0', 40, 20);
    list('empty');
    const { controls, posted } = mount();
    controls.setMeta({ ...META, readOnly: true });
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await frame();

    const bar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Block"]');
    expect(bar?.style.display).toBe('none');
    expect(document.querySelector('button.manablox-controls-add')).toBeNull();
    bar?.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();
    expect(posted).toEqual([]);
  });

  it('takes its overlay and its stylesheet away again', async () => {
    const { controls } = mount();
    await frame();
    expect(document.querySelector('.manablox-controls')).not.toBeNull();
    controls.destroy();
    expect(document.querySelector('.manablox-controls')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
  });
});
