import {
  child,
  hide,
  icon,
  iconButton,
  place,
  placeBar,
  separator,
  show,
  stylesheet,
} from '../dom.js';
import type { Edge } from './hit-test.js';

/**
 * The block controls' drawing: outlines, toolbar, resize handles, drop line and drag
 * ghost. Works on rectangles only; it knows nothing about blocks.
 */

const NS = 'manablox-controls';

const ICONS = {
  grip: icon(
    '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>',
  ),
  up: icon(
    '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  down: icon(
    '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  plus: icon(
    '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  ),
  trash: icon(
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
};

const STYLE = `
.${NS}{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:500 12px/1 system-ui,sans-serif;color:#1c1533}
.${NS} *{box-sizing:border-box}
.${NS}-outline,.${NS}-highlight{position:fixed;border:2px solid #7c6cf7;border-radius:6px;pointer-events:none;transition:top .08s,left .08s,width .08s,height .08s}
.${NS}-highlight{border-style:dashed;border-color:#22b8cf}
.${NS}-label{position:absolute;top:-2px;left:-2px;transform:translateY(-100%);padding:3px 7px 4px;background:#7c6cf7;color:#fff;font:600 11px/1 system-ui,sans-serif;border-radius:5px 5px 5px 0;white-space:nowrap;letter-spacing:.01em}
.${NS}-highlight .${NS}-label{background:#22b8cf}
.${NS}-bar{position:fixed;display:flex;align-items:center;gap:1px;padding:3px;background:#fff;border:1px solid #ddd8f8;border-radius:9px;box-shadow:0 8px 24px rgba(28,21,51,.16),0 1px 2px rgba(28,21,51,.08);pointer-events:auto}
.${NS}-bar i{width:1px;height:16px;margin:0 3px;background:#e6e2fb}
.${NS}-bar button{all:unset;display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:#4b4373;cursor:pointer}
.${NS}-bar button:hover{background:#efedfd;color:#4a38e0}
.${NS}-bar button:disabled{opacity:.3;cursor:default;background:none}
.${NS}-bar button svg{width:15px;height:15px;fill:currentColor}
.${NS}-bar button[data-action="delete"]:hover{background:#fdecef;color:#d1264b}
.${NS}-bar button[data-action="drag"]{cursor:grab;color:#7c6cf7}
.${NS}-handle{position:fixed;pointer-events:auto;background:#fff;border:2px solid #7c6cf7;border-radius:999px;width:12px;height:12px;box-shadow:0 1px 3px rgba(28,21,51,.25)}
.${NS}-handle[data-edge="e"]{cursor:ew-resize}
.${NS}-handle[data-edge="s"]{cursor:ns-resize}
.${NS}-handle[data-edge="se"]{cursor:nwse-resize;width:14px;height:14px;border-radius:4px}
.${NS}-drop{position:fixed;height:3px;background:#7c6cf7;border-radius:2px;pointer-events:none;box-shadow:0 0 0 2px rgba(124,108,247,.25)}
.${NS}-ghost{position:fixed;pointer-events:none;border:2px dashed #7c6cf7;background:rgba(124,108,247,.12);border-radius:6px}
.${NS}-ghost span{position:absolute;right:6px;bottom:4px;font:600 11px system-ui,sans-serif;color:#4a38e0}
.${NS}-add{position:fixed;pointer-events:auto;all:unset;display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:1px dashed #a89ff7;border-radius:999px;background:#fff;color:#4a38e0;cursor:pointer;font:500 12px system-ui,sans-serif;pointer-events:auto}
.${NS}-add svg{width:14px;height:14px;fill:currentColor}
.${NS}-add:hover{background:#efedfd}
.${NS}-dragging,.${NS}-dragging *{cursor:grabbing!important;user-select:none!important}
.${NS}-resizing *{user-select:none!important}
`;

const HANDLE_TITLES: Record<Edge, string> = {
  e: 'Drag to change the width',
  s: 'Drag to change the height',
  se: 'Drag to resize',
};

export type Action = 'up' | 'down' | 'add' | 'delete';

export interface OverlayOptions {
  /** A toolbar button other than drag was pressed. */
  act: (action: Action) => void;
  /** An empty list's "add a block" button was pressed. */
  addTo: (raw: string) => void;
}

/** An empty list that gets a centred "add a block" button. */
export interface EmptyList {
  raw: string;
  rect: DOMRect;
}

export interface Overlay {
  root: HTMLElement;
  /** Starts a drag; the handles start a resize. */
  grip: HTMLButtonElement;
  handles: Record<Edge, HTMLElement>;
  bar: HTMLElement;
  drawBlock(rect: DOMRect, label: string, moves: { up: boolean; down: boolean }): void;
  hideBlock(): void;
  drawHighlight(rect: DOMRect, label: string): void;
  hideHighlight(): void;
  drawHandles(rect: DOMRect): void;
  hideHandles(): void;
  drawDrop(rect: DOMRect, above: boolean): void;
  hideDrop(): void;
  drawGhost(rect: DOMRect, label: string): void;
  hideGhost(): void;
  drawAdders(lists: EmptyList[]): void;
  /** Sets the page cursor and selection lock for a gesture. */
  setCursor(mode: 'drag' | 'resize' | null): void;
  destroy(): void;
}

export function createOverlay(options: OverlayOptions): Overlay {
  const doc = window.document;
  const style = stylesheet(STYLE);

  const root = doc.createElement('div');
  root.className = NS;
  const outline = child(root, 'div', `${NS}-outline`);
  const outlineLabel = child(outline, 'span', `${NS}-label`);
  const highlightBox = child(root, 'div', `${NS}-highlight`);
  const highlightLabel = child(highlightBox, 'span', `${NS}-label`);
  const drop = child(root, 'div', `${NS}-drop`);
  const ghost = child(root, 'div', `${NS}-ghost`);
  const ghostLabel = child(ghost, 'span', '');
  const bar = child(root, 'div', `${NS}-bar`);
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Block');
  const handles: Record<Edge, HTMLElement> = {
    e: child(root, 'div', `${NS}-handle`),
    s: child(root, 'div', `${NS}-handle`),
    se: child(root, 'div', `${NS}-handle`),
  };
  for (const edge of ['e', 's', 'se'] as const) {
    handles[edge].dataset.edge = edge;
    handles[edge].title = HANDLE_TITLES[edge];
  }
  doc.body.appendChild(root);

  const action = (value: Action, label: string, markup: string) =>
    iconButton(bar, {
      key: 'action',
      value,
      label,
      icon: markup,
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.act(value);
      },
    });

  const grip = iconButton(bar, {
    key: 'action',
    value: 'drag',
    label: 'Drag to move',
    icon: ICONS.grip,
  });
  separator(bar);
  const up = action('up', 'Move up', ICONS.up);
  const down = action('down', 'Move down', ICONS.down);
  separator(bar);
  action('add', 'Add a block after this one', ICONS.plus);
  action('delete', 'Delete block', ICONS.trash);

  // Hovering the toolbar itself must not count as leaving the block.
  bar.addEventListener('pointerover', (event) => event.stopPropagation());

  /** One "add a block" button per empty, tagged list. */
  const adders = new Map<string, HTMLButtonElement>();

  return {
    root,
    grip,
    handles,
    bar,

    drawBlock(rect, label, moves) {
      place(outline, rect.top - 2, rect.left - 2, rect.width + 4, rect.height + 4);
      outlineLabel.textContent = label;
      up.disabled = !moves.up;
      down.disabled = !moves.down;
      show(bar);
      // Above the block if there is room, else inside its corner.
      placeBar(bar, rect, { gap: 6, fallback: 'inside', align: 'end' });
    },

    hideBlock() {
      hide(outline);
      hide(bar);
    },

    drawHighlight(rect, label) {
      place(highlightBox, rect.top - 2, rect.left - 2, rect.width + 4, rect.height + 4);
      highlightLabel.textContent = label;
    },

    hideHighlight() {
      hide(highlightBox);
    },

    drawHandles(rect) {
      place(handles.e, rect.top + rect.height / 2 - 6, rect.right - 6, 12, 12);
      place(handles.s, rect.bottom - 6, rect.left + rect.width / 2 - 6, 12, 12);
      place(handles.se, rect.bottom - 7, rect.right - 7, 14, 14);
    },

    hideHandles() {
      for (const edge of ['e', 's', 'se'] as const) hide(handles[edge]);
    },

    drawDrop(rect, above) {
      place(drop, above ? rect.top - 3 : rect.bottom, rect.left, rect.width, 3);
    },

    hideDrop() {
      hide(drop);
    },

    drawGhost(rect, label) {
      place(ghost, rect.top, rect.left, rect.width, rect.height);
      ghostLabel.textContent = label;
    },

    hideGhost() {
      hide(ghost);
    },

    drawAdders(lists) {
      const seen = new Set<string>();
      for (const { raw, rect } of lists) {
        seen.add(raw);
        let adder = adders.get(raw);
        if (!adder) {
          adder = doc.createElement('button');
          adder.type = 'button';
          adder.className = `${NS}-add`;
          adder.innerHTML = `${ICONS.plus}<span>Add a block</span>`;
          adder.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.addTo(raw);
          });
          root.appendChild(adder);
          adders.set(raw, adder);
        }
        show(adder);
        const width = adder.offsetWidth;
        const height = adder.offsetHeight;
        adder.style.top = `${rect.top + Math.max(4, (rect.height - height) / 2)}px`;
        adder.style.left = `${rect.left + Math.max(4, (rect.width - width) / 2)}px`;
      }
      for (const [raw, adder] of adders) {
        if (!seen.has(raw)) {
          adder.remove();
          adders.delete(raw);
        }
      }
    },

    setCursor(mode) {
      const classes = doc.documentElement.classList;
      classes.remove(`${NS}-dragging`, `${NS}-resizing`);
      if (mode) classes.add(mode === 'drag' ? `${NS}-dragging` : `${NS}-resizing`);
    },

    destroy() {
      root.remove();
      style.remove();
    },
  };
}
