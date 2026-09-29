import type { BoardCell } from '@manablox/admin-sdk/features/content/model/block-grid';
import type { BlockPlacement, BlockValue } from '@manablox/core';
import { type Ref, ref } from 'vue';
import {
  type BoardEdges,
  type BoardPoint,
  cellKey,
  drawnRectangle,
  movedTo,
  resizedTo,
  sameCell,
} from './model/block-board';

interface BoardPointerOptions {
  /** The board's grid element; cells carry `data-cell`, `data-column` and `data-row`. */
  map: Readonly<Ref<HTMLElement | null>>;
  blocks: () => BlockValue[];
  /** Where each block sits, by block id. */
  placed: () => ReadonlyMap<string, BoardCell>;
  /** `column:row` of every covered cell. */
  occupied: () => Set<string>;
  readOnly: () => boolean;
  insertable: () => boolean;
  /** A block's new cell while it is dragged. */
  commit: (block: BlockValue, next: BoardCell) => void;
  /** Pointer down on a block. */
  onActive: (blockId: string) => void;
  /** A block clicked without dragging. */
  onSelect: (blockId: string) => void;
  /** A rectangle drawn on empty cells. */
  onInsert: (placement: BlockPlacement) => void;
}

/**
 * The block board's pointer work: dragging a block to move it or an edge to resize it, and
 * drawing a rectangle on empty cells to add one. The cell under the pointer is what a drag
 * follows.
 */
export function useBoardPointer(options: BoardPointerOptions) {
  const dragging = ref<{ id: string; edges: BoardEdges | null; moved: boolean } | null>(null);
  let origin: { cell: BoardCell; pointer: BoardPoint } | null = null;

  function cellUnder(x: number, y: number): BoardPoint | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]');
    if (!target || !options.map.value?.contains(target)) return null;
    return { column: Number(target.dataset.column), row: Number(target.dataset.row) };
  }

  /** `edges` null moves the block; otherwise it resizes those sides. */
  function startDrag(event: PointerEvent, block: BlockValue, edges: BoardEdges | null) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const cell = options.placed().get(block.blockId);
    if (!cell) return;
    origin = {
      cell,
      pointer: cellUnder(event.clientX, event.clientY) ?? { column: cell.column, row: cell.row },
    };
    dragging.value = { id: block.blockId, edges, moved: false };
    // Select without opening, so the steppers follow the drag.
    options.onActive(block.blockId);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDrag(event: PointerEvent) {
    if (!dragging.value || !origin) return;
    const block = options.blocks().find((entry) => entry.blockId === dragging.value?.id);
    const current = block ? options.placed().get(block.blockId) : null;
    const pointer = cellUnder(event.clientX, event.clientY);
    if (!block || !current || !pointer) return;
    const next = dragging.value.edges
      ? resizedTo(origin.cell, pointer, dragging.value.edges)
      : movedTo(origin.cell, origin.pointer, pointer);
    if (!options.readOnly() && !sameCell(next, current)) {
      dragging.value.moved = true;
      options.commit(block, next);
    }
  }

  function endDrag(event: PointerEvent) {
    if (!dragging.value) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    // An unmoved press on the body (not an edge) is a click.
    if (!dragging.value.moved && !dragging.value.edges) options.onSelect(dragging.value.id);
    dragging.value = null;
    origin = null;
  }

  // Drawing a new block.

  const drawn = ref<BoardCell | null>(null);
  let drawOrigin: BoardPoint | null = null;

  function startDraw(event: PointerEvent, cell: BoardPoint) {
    if (event.button !== 0 || !options.insertable()) return;
    if (options.occupied().has(cellKey(cell.column, cell.row))) return;
    event.preventDefault();
    drawOrigin = cell;
    drawn.value = { ...cell, columnSpan: 1, rowSpan: 1 };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDraw(event: PointerEvent) {
    if (!drawn.value || !drawOrigin) return;
    const pointer = cellUnder(event.clientX, event.clientY);
    if (pointer) drawn.value = drawnRectangle(drawOrigin, pointer, options.occupied());
  }

  function endDraw(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const rectangle = drawn.value;
    drawn.value = null;
    drawOrigin = null;
    if (rectangle) options.onInsert(rectangle);
  }

  return { dragging, startDrag, onDrag, endDrag, drawn, startDraw, onDraw, endDraw };
}
