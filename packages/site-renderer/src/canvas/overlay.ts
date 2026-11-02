/** The canvas' drawing layer: hover, selection, highlights, drop line. Rectangles only. */

const NS = 'mb-canvas-ui';

const STYLE = `
.${NS}{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:600 11px/1 system-ui,sans-serif}
.${NS} *{box-sizing:border-box}
.${NS}-box{position:fixed;display:none;pointer-events:none;border-radius:3px}
.${NS}-hover{outline:1px solid #7c6cf7;outline-offset:-1px}
.${NS}-select{outline:2px solid #7c6cf7;outline-offset:-2px}
.${NS}-highlight{outline:2px dashed #22b8cf;outline-offset:-2px}
.${NS}-chip{position:absolute;left:-2px;top:-2px;transform:translateY(-100%);padding:3px 7px 4px;background:#7c6cf7;color:#fff;border-radius:4px 4px 4px 0;white-space:nowrap;pointer-events:auto;cursor:grab;user-select:none}
.${NS}-resize{position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#fff;border:2px solid #7c6cf7;border-radius:3px;pointer-events:auto;cursor:nwse-resize}
.${NS}-drop{position:fixed;display:none;height:3px;background:#7c6cf7;border-radius:2px;box-shadow:0 0 0 2px rgba(124,108,247,.25)}
.${NS}[data-dragging] *{pointer-events:none!important}
[data-mb-empty]{min-height:1.75em;outline:1px dashed rgba(124,108,247,.55);outline-offset:-1px}
[data-mb-empty]:empty::before{content:attr(data-mb-empty);display:block;padding:4px 8px;opacity:.6;font:500 12px/1.4 system-ui,sans-serif}
[data-mb-editing]{outline:2px solid #22b8cf!important;outline-offset:2px;cursor:text}
`;

export interface Overlay {
  root: HTMLElement;
  chip: HTMLElement;
  resize: HTMLElement;
  hover(rect: DOMRect | null): void;
  select(rect: DOMRect | null, label: string, resizable: boolean): void;
  highlight(rects: DOMRect[]): void;
  /** A horizontal drop line; `null` hides it. */
  drop(line: { left: number; top: number; width: number } | null): void;
  dragging(on: boolean): void;
  owns(target: EventTarget | null): boolean;
  destroy(): void;
}

function place(element: HTMLElement, rect: DOMRect | null): void {
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    element.style.display = 'none';
    return;
  }
  element.style.display = 'block';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

export function createOverlay(doc: Document = document): Overlay {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.className = NS;
  root.setAttribute('aria-hidden', 'true');
  const box = (kind: string) => {
    const element = doc.createElement('div');
    element.className = `${NS}-box ${NS}-${kind}`;
    root.appendChild(element);
    return element;
  };
  const hoverBox = box('hover');
  const selectBox = box('select');
  const chip = doc.createElement('div');
  chip.className = `${NS}-chip`;
  selectBox.appendChild(chip);
  const resize = doc.createElement('div');
  resize.className = `${NS}-resize`;
  selectBox.appendChild(resize);
  const dropLine = doc.createElement('div');
  dropLine.className = `${NS}-drop`;
  root.appendChild(dropLine);
  const highlights: HTMLElement[] = [];
  doc.body.appendChild(root);

  return {
    root,
    chip,
    resize,
    hover: (rect) => place(hoverBox, rect),
    select(rect, label, resizable) {
      place(selectBox, rect);
      chip.textContent = label;
      resize.style.display = resizable ? '' : 'none';
    },
    highlight(rects) {
      while (highlights.length < rects.length) highlights.push(box('highlight'));
      highlights.forEach((element, index) => {
        place(element, rects[index] ?? null);
      });
    },
    drop(line) {
      if (!line) {
        dropLine.style.display = 'none';
        return;
      }
      dropLine.style.display = 'block';
      dropLine.style.left = `${line.left}px`;
      dropLine.style.top = `${line.top - 1}px`;
      dropLine.style.width = `${line.width}px`;
    },
    dragging(on) {
      if (on) root.setAttribute('data-dragging', '');
      else root.removeAttribute('data-dragging');
    },
    owns: (target) => target instanceof Node && root.contains(target),
    destroy() {
      root.remove();
      style.remove();
    },
  };
}
