import {
  beginGrid,
  beginReorder,
  commitDrag,
  type Drag,
  draggedPath,
  moveDrag,
} from './controls/drag.js';
import {
  areaRect,
  blockOf,
  type Edge,
  elementFor,
  geometryOf,
  indexOf,
  labelFor,
  listElements,
  listOf,
  siblingsOf,
} from './controls/hit-test.js';
import { type Action, createOverlay, type EmptyList } from './controls/overlay.js';
import {
  blockPathWithin,
  type FieldPath,
  isBlockPath,
  PROTOCOL_VERSION,
  type PreviewMessage,
  type PreviewMeta,
  parseFieldPath,
  samePath,
} from './protocol.js';

/**
 * The block toolbar in the preview frame: outlines the hovered block and offers drag, move,
 * add and delete as requests to the editor. State is kept as paths to survive re-renders.
 */

export interface BlockControlsOptions {
  post: (message: PreviewMessage) => void;
}

export interface BlockControls {
  /** The page re-rendered; positions are stale. */
  documentChanged(): void;
  /** Labels and grids, from the editor's last document. */
  setMeta(meta: PreviewMeta): void;
  /** Outlines the editor's selection. */
  setHighlight(path: FieldPath | null): void;
  /** Whether an event target is part of the overlay rather than the page. */
  owns(target: EventTarget | null): boolean;
  destroy(): void;
}

export function mountBlockControls(options: BlockControlsOptions): BlockControls {
  const doc = window.document;

  let meta: PreviewMeta = { editable: {}, labels: {}, grids: {} };
  let hovered: FieldPath | null = null;
  let highlighted: FieldPath | null = null;
  let drag: Drag | null = null;
  let frame = 0;

  /** The toolbar's block: the dragged one, else hovered, else highlighted. */
  const active = (): FieldPath | null => {
    if (drag) return draggedPath(drag);
    return hovered ?? highlighted;
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
  };

  const overlay = createOverlay({
    act: (action) => act(action),
    addTo: (raw) => {
      if (meta.readOnly) return;
      options.post({
        v: PROTOCOL_VERSION,
        kind: 'addBlock',
        list: parseFieldPath(raw),
        index: 0,
      });
    },
  });

  // --- drawing ---------------------------------------------------------------------------

  function layout() {
    if (meta.readOnly) return layoutReadOnly();
    const path = active();
    const element = path ? elementFor(path) : null;
    if (!element || !path) {
      overlay.hideBlock();
      overlay.hideHandles();
    } else {
      const rect = element.getBoundingClientRect();
      const list = listOf(path);
      const index = indexOf(path);
      const siblings = siblingsOf(list);
      overlay.drawBlock(rect, labelFor(meta, path), {
        up: index > 0,
        down: index < siblings.length - 1,
      });

      // Resize handles only on the selected block, and only on a grid.
      if (samePath(highlighted, path) && geometryOf(meta, list) && !drag) {
        overlay.drawHandles(rect);
      } else {
        overlay.hideHandles();
      }
    }

    const highlightedElement =
      highlighted && !samePath(highlighted, path) ? elementFor(highlighted) : null;
    if (highlightedElement) {
      overlay.drawHighlight(
        highlightedElement.getBoundingClientRect(),
        labelFor(meta, highlighted as FieldPath),
      );
    } else {
      overlay.hideHighlight();
    }

    layoutAdders();
    layoutDrop();
    layoutGhost();
  }

  /** Only the selection's outline; no toolbar, handles or adders. */
  function layoutReadOnly() {
    overlay.hideBlock();
    overlay.hideHandles();
    overlay.drawAdders([]);
    overlay.hideDrop();
    overlay.hideGhost();
    const element = highlighted ? elementFor(highlighted) : null;
    if (element && highlighted) {
      overlay.drawHighlight(element.getBoundingClientRect(), labelFor(meta, highlighted));
    } else {
      overlay.hideHighlight();
    }
  }

  /** An "add a block" button in every empty tagged list. */
  function layoutAdders() {
    const empty: EmptyList[] = [];
    for (const { raw, path, element } of listElements()) {
      if (siblingsOf(path).length > 0) continue;
      empty.push({ raw, rect: element.getBoundingClientRect() });
    }
    overlay.drawAdders(empty);
  }

  function layoutDrop() {
    if (drag?.mode !== 'reorder' || drag.to === null) return overlay.hideDrop();
    const siblings = siblingsOf(drag.list);
    const before = siblings[drag.to];
    const after = siblings[drag.to - 1];
    const rect = before?.getBoundingClientRect() ?? after?.getBoundingClientRect();
    if (!rect) return overlay.hideDrop();
    overlay.drawDrop(rect, Boolean(before));
  }

  function layoutGhost() {
    if (!drag || drag.mode === 'reorder') return overlay.hideGhost();
    overlay.drawGhost(
      areaRect(drag.geometry, drag.area),
      `${drag.area.columnSpan}x${drag.area.rowSpan}`,
    );
  }

  // --- pointer handling ----------------------------------------------------------------

  const onPointerOver = (event: PointerEvent) => {
    if (drag || overlay.root.contains(event.target as Node)) return;
    const next = blockOf(event.target);
    if (samePath(next, hovered)) return;
    hovered = next;
    schedule();
  };

  const onPointerLeave = () => {
    if (drag) return;
    hovered = null;
    schedule();
  };

  const onDragStart = (event: PointerEvent) => {
    const path = active();
    if (!path || event.button !== 0 || meta.readOnly) return;
    event.preventDefault();
    // Move on a grid, otherwise reorder.
    drag = beginGrid(meta, path, 'move', null, event.clientX, event.clientY) ?? beginReorder(path);
    overlay.grip.setPointerCapture(event.pointerId);
    overlay.setCursor('drag');
    schedule();
  };

  const onHandleStart = (event: PointerEvent) => {
    const path = highlighted;
    const edge = (event.currentTarget as HTMLElement).dataset.edge as Edge | undefined;
    if (!path || !edge || event.button !== 0 || meta.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const started = beginGrid(meta, path, 'resize', edge, event.clientX, event.clientY);
    if (!started) return;
    drag = started;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    overlay.setCursor('resize');
    schedule();
  };

  const onDragMove = (event: PointerEvent) => {
    if (!drag) return;
    moveDrag(drag, meta, event.clientX, event.clientY);
    schedule();
  };

  const onDragEnd = (event: PointerEvent) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    overlay.setCursor(null);
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const message = commitDrag(current);
    if (message) options.post(message);
    schedule();
  };

  overlay.grip.addEventListener('pointerdown', onDragStart);
  overlay.grip.addEventListener('pointermove', onDragMove);
  overlay.grip.addEventListener('pointerup', onDragEnd);
  overlay.grip.addEventListener('pointercancel', onDragEnd);
  for (const edge of ['e', 's', 'se'] as const) {
    overlay.handles[edge].addEventListener('pointerdown', onHandleStart);
    overlay.handles[edge].addEventListener('pointermove', onDragMove);
    overlay.handles[edge].addEventListener('pointerup', onDragEnd);
    overlay.handles[edge].addEventListener('pointercancel', onDragEnd);
  }

  function act(action: Action) {
    const path = active();
    if (!path || meta.readOnly) return;
    const list = listOf(path);
    const index = indexOf(path);
    const last = siblingsOf(list).length - 1;
    switch (action) {
      case 'up':
        if (index > 0) {
          options.post({
            v: PROTOCOL_VERSION,
            kind: 'moveBlock',
            list,
            from: index,
            to: index - 1,
          });
        }
        break;
      case 'down':
        if (index < last) {
          options.post({
            v: PROTOCOL_VERSION,
            kind: 'moveBlock',
            list,
            from: index,
            to: index + 1,
          });
        }
        break;
      case 'add':
        options.post({ v: PROTOCOL_VERSION, kind: 'addBlock', list, index: index + 1 });
        break;
      case 'delete':
        options.post({ v: PROTOCOL_VERSION, kind: 'removeBlock', list, index });
        hovered = null;
        break;
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);

  schedule();

  return {
    documentChanged() {
      // Again shortly after, for async renders and late fonts or images.
      schedule();
      window.setTimeout(schedule, 120);
    },
    setMeta(next) {
      meta = next;
      schedule();
    },
    setHighlight(path) {
      highlighted = path && isBlockPath(path) ? path : path ? blockPathWithin(path) : null;
      schedule();
    },
    owns: (target) => target instanceof Node && overlay.root.contains(target),
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      overlay.destroy();
    },
  };
}
