import {
  type BlockPlacement,
  type FieldPath,
  PROTOCOL_VERSION,
  type PreviewMessage,
  type PreviewMeta,
} from '../protocol.js';
import {
  type Area,
  areaOf,
  breakpoint,
  type Cell,
  cellAt,
  clampArea,
  type Edge,
  elementFor,
  type Geometry,
  geometryOf,
  indexOf,
  insertionIndex,
  listOf,
  sameArea,
  siblingsOf,
} from './hit-test.js';

/**
 * The drag state machine (reorder in a list, move or resize on a grid), from pointer-down
 * to the editor message. Kept standalone so tests can drive it without a toolbar.
 */

export type Drag =
  | { mode: 'reorder'; list: FieldPath; from: number; to: number | null }
  | {
      mode: 'move' | 'resize';
      list: FieldPath;
      index: number;
      geometry: Geometry;
      origin: Area;
      pointerCell: Cell;
      edge: Edge | null;
      area: Area;
    };

/** The block being dragged. */
export function draggedPath(drag: Drag): FieldPath {
  return [...drag.list, drag.mode === 'reorder' ? drag.from : drag.index];
}

/** A grid drag, or null when the block is not on a grid. */
export function beginGrid(
  meta: PreviewMeta,
  path: FieldPath,
  mode: 'move' | 'resize',
  edge: Edge | null,
  x: number,
  y: number,
): Drag | null {
  const list = listOf(path);
  const geometry = geometryOf(meta, list);
  const element = elementFor(path);
  if (!geometry || !element) return null;
  const origin = areaOf(geometry, element.getBoundingClientRect());
  return {
    mode,
    list,
    index: indexOf(path),
    geometry,
    origin,
    pointerCell: cellAt(geometry, x, y),
    edge,
    area: origin,
  };
}

export function beginReorder(path: FieldPath): Drag {
  return { mode: 'reorder', list: listOf(path), from: indexOf(path), to: null };
}

/** Updates the drag for a pointer position; draws nothing. */
export function moveDrag(drag: Drag, meta: PreviewMeta, x: number, y: number): void {
  if (drag.mode === 'reorder') {
    drag.to = insertionIndex(siblingsOf(drag.list), x, y);
    return;
  }
  const cell = cellAt(drag.geometry, x, y);
  if (drag.mode === 'move') {
    drag.area = clampArea(meta, drag.list, drag.geometry, {
      ...drag.origin,
      column: drag.origin.column + (cell.column - drag.pointerCell.column),
      row: drag.origin.row + (cell.row - drag.pointerCell.row),
    });
    return;
  }
  const widen = drag.edge === 'e' || drag.edge === 'se';
  const heighten = drag.edge === 's' || drag.edge === 'se';
  drag.area = clampArea(meta, drag.list, drag.geometry, {
    ...drag.origin,
    columnSpan: widen ? cell.column - drag.origin.column + 1 : drag.origin.columnSpan,
    rowSpan: heighten ? cell.row - drag.origin.row + 1 : drag.origin.rowSpan,
  });
}

/** The message for the editor, or null when nothing changed (keeps the document clean). */
export function commitDrag(drag: Drag): PreviewMessage | null {
  if (drag.mode === 'reorder') {
    if (drag.to === null) return null;
    // `to` is a gap index (0...length); convert it to the item's final index.
    const to = drag.to > drag.from ? drag.to - 1 : drag.to;
    if (to === drag.from) return null;
    return {
      v: PROTOCOL_VERSION,
      kind: 'moveBlock',
      list: drag.list,
      from: drag.from,
      to,
    };
  }
  if (sameArea(drag.area, drag.origin)) return null;
  const placement: BlockPlacement = {
    column: drag.area.column,
    row: drag.area.row,
    columnSpan: drag.area.columnSpan,
    rowSpan: drag.area.rowSpan,
  };
  return {
    v: PROTOCOL_VERSION,
    kind: 'layoutBlock',
    list: drag.list,
    index: drag.index,
    breakpoint: breakpoint(),
    placement,
  };
}
