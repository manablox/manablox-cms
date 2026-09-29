import {
  blocksOf,
  gridValueOf,
  isBlockGrid,
  resolveBlockGrid,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import { moveInList } from '@manablox/admin-sdk/lib/collections';
import type {
  BlockBreakpoint,
  BlockGrid,
  BlockGridValue,
  BlockLayout,
  BlocksValue,
  BlockValue,
} from '@manablox/core';
import { computed } from 'vue';

/**
 * A blocks field's value, `{ grid, blocks }`, and its edits. Every edit emits a new value;
 * mutations replace the array so dirty tracking and undo stay reliable.
 */
export function useBlocksValue(value: () => unknown, emit: (next: BlocksValue) => void) {
  const blocks = computed(() => blocksOf(value()));
  const gridValue = computed(() => gridValueOf(value()));

  function emitValue(next: { grid?: BlockGridValue | undefined; blocks: BlockValue[] }) {
    const { grid, blocks: list } = next;
    emit(grid && Object.keys(grid).length ? { grid, blocks: list } : { blocks: list });
  }
  function emitBlocks(list: BlockValue[]) {
    emitValue({ grid: gridValue.value, blocks: list });
  }

  /** Per-document grid; tablet defaults to desktop, mobile to one column. */
  const grid = computed(() => resolveBlockGrid(gridValue.value));
  const isGrid = computed(() => isBlockGrid(grid.value));
  function setGrid(breakpoint: BlockBreakpoint, patch: Partial<BlockGrid> | null) {
    const current = { ...(gridValue.value ?? {}) };
    if (patch === null) delete current[breakpoint];
    else {
      const base = current[breakpoint] ?? { columns: grid.value[breakpoint].columns };
      const next: BlockGrid = { ...base, ...patch };
      if (next.rows === undefined) delete next.rows;
      current[breakpoint] = next;
    }
    emitValue({ grid: current, blocks: blocks.value });
  }

  function updateLayout(blockId: string, layout: BlockLayout | undefined) {
    emitBlocks(
      blocks.value.map((block) => {
        if (block.blockId !== blockId) return block;
        const { layout: _previous, ...rest } = block;
        return layout ? { ...rest, layout } : rest;
      }),
    );
  }

  function append(block: BlockValue) {
    emitBlocks([...blocks.value, block]);
  }

  function removeBlock(blockId: string) {
    emitBlocks(blocks.value.filter((block) => block.blockId !== blockId));
  }

  function updateBlock(blockId: string, fields: Record<string, unknown>) {
    emitBlocks(
      blocks.value.map((block) => (block.blockId === blockId ? { ...block, fields } : block)),
    );
  }

  /** A slot entry's whole new block. */
  function replaceBlock(blockId: string, next: BlockValue) {
    emitBlocks(blocks.value.map((block) => (block.blockId === blockId ? next : block)));
  }

  function move(from: number, to: number) {
    const next = moveInList(blocks.value, from, to);
    if (next !== blocks.value) emitBlocks([...next]);
  }

  return {
    blocks,
    gridValue,
    grid,
    isGrid,
    setGrid,
    updateLayout,
    append,
    removeBlock,
    updateBlock,
    replaceBlock,
    move,
  };
}
