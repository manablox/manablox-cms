import {
  type BlockBreakpoint,
  breakpointFor,
  FIELD_ATTRIBUTE,
  type FieldPath,
  isBlockPath,
  LIST_ATTRIBUTE,
  type PreviewMeta,
  parseFieldPath,
} from '../protocol.js';

/**
 * Stateless page queries (blocks, siblings, grid tracks), resolved from the
 * `data-manablox-*` tags on every call so they survive re-renders.
 */

export type Edge = 'e' | 's' | 'se';

export interface Track {
  start: number;
  end: number;
}

export interface Geometry {
  list: HTMLElement;
  rect: DOMRect;
  columns: Track[];
  rows: Track[];
  columnGap: number;
  rowGap: number;
  fixedRows: boolean;
}

export interface Cell {
  column: number;
  row: number;
}

export interface Area extends Cell {
  columnSpan: number;
  rowSpan: number;
}

// --- paths ---------------------------------------------------------------------------

export function listOf(path: FieldPath): FieldPath {
  return path.slice(0, -1);
}

export function indexOf(path: FieldPath): number {
  const last = path[path.length - 1];
  return typeof last === 'number' ? last : -1;
}

function pathOf(element: Element): FieldPath {
  return parseFieldPath(element.getAttribute(FIELD_ATTRIBUTE) ?? '');
}

/** The block's name, plus its position when the list has several. */
export function labelFor(meta: PreviewMeta, path: FieldPath): string {
  const name = meta.labels[path.join('.')] ?? 'Block';
  const index = indexOf(path);
  const total = siblingsOf(listOf(path)).length;
  return total > 1 ? `${name} - ${index + 1}/${total}` : name;
}

// --- elements ------------------------------------------------------------------------

export function elementFor(path: FieldPath): HTMLElement | null {
  return tagged(FIELD_ATTRIBUTE, path);
}

function listElementFor(list: FieldPath): HTMLElement | null {
  return tagged(LIST_ATTRIBUTE, list);
}

function tagged(attribute: string, path: FieldPath): HTMLElement | null {
  const value = path.join('.');
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value;
  return window.document.querySelector<HTMLElement>(`[${attribute}="${escaped}"]`);
}

/** The blocks of one list, in document order. */
export function siblingsOf(list: FieldPath): HTMLElement[] {
  const prefix = list.length ? `${list.join('.')}.` : '';
  const out: HTMLElement[] = [];
  for (const element of window.document.querySelectorAll<HTMLElement>(`[${FIELD_ATTRIBUTE}]`)) {
    const raw = element.getAttribute(FIELD_ATTRIBUTE) ?? '';
    if (!raw.startsWith(prefix)) continue;
    const rest = raw.slice(prefix.length);
    if (/^\d+$/.test(rest)) out.push(element);
  }
  return out.sort((a, b) => indexOf(pathOf(a)) - indexOf(pathOf(b)));
}

/** Every tagged list on the page, empty or not. */
export function listElements(): { raw: string; path: FieldPath; element: HTMLElement }[] {
  const out: { raw: string; path: FieldPath; element: HTMLElement }[] = [];
  for (const element of window.document.querySelectorAll<HTMLElement>(`[${LIST_ATTRIBUTE}]`)) {
    const raw = element.getAttribute(LIST_ATTRIBUTE) ?? '';
    out.push({ raw, path: parseFieldPath(raw), element });
  }
  return out;
}

/** The nearest tagged ancestor that is a block, or null. */
export function blockOf(target: EventTarget | null): FieldPath | null {
  let element = target instanceof Element ? target : null;
  while (element) {
    const found = element.closest<HTMLElement>(`[${FIELD_ATTRIBUTE}]`);
    if (!found) return null;
    const path = pathOf(found);
    if (isBlockPath(path)) return path;
    element = found.parentElement;
  }
  return null;
}

/** The insertion index at a point: before or after the nearest block, on both axes. */
export function insertionIndex(
  siblings: readonly { getBoundingClientRect(): DOMRect }[],
  x: number,
  y: number,
): number {
  if (siblings.length === 0) return 0;
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let after = false;
  siblings.forEach((sibling, index) => {
    const rect = sibling.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(0, Math.abs(x - cx) - rect.width / 2);
    const dy = Math.max(0, Math.abs(y - cy) - rect.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
      const nx = rect.width ? (x - cx) / rect.width : 0;
      const ny = rect.height ? (y - cy) / rect.height : 0;
      after = nx + ny > 0;
    }
  });
  return after ? nearest + 1 : nearest;
}

// --- grid geometry -------------------------------------------------------------------

export function breakpoint(): BlockBreakpoint {
  return breakpointFor(window.innerWidth);
}

/** A grid list's tracks, or null for a plain list. */
export function geometryOf(meta: PreviewMeta, list: FieldPath): Geometry | null {
  const element = listElementFor(list);
  if (!element) return null;
  const computed = getComputedStyle(element);
  if (computed.display !== 'grid' && computed.display !== 'inline-grid') return null;
  const columnGap = Number.parseFloat(computed.columnGap) || 0;
  const rowGap = Number.parseFloat(computed.rowGap) || 0;
  const rect = element.getBoundingClientRect();
  const columns = tracks(
    computed.gridTemplateColumns,
    rect.left + (Number.parseFloat(computed.paddingLeft) || 0),
    columnGap,
  );
  const rows = tracks(
    computed.gridTemplateRows,
    rect.top + (Number.parseFloat(computed.paddingTop) || 0),
    rowGap,
  );
  if (columns.length === 0) return null;
  const grid = meta.grids[list.join('.')];
  const fixedRows = Boolean(grid?.[breakpoint()].rows);
  return { list: element, rect, columns, rows, columnGap, rowGap, fixedRows };
}

/** The cells a block's box covers. */
export function areaOf(geometry: Geometry, rect: DOMRect): Area {
  const columnStart = trackAt(geometry.columns, rect.left + 1);
  const columnEnd = trackAt(geometry.columns, rect.right - 1);
  const rowStart = trackAt(geometry.rows, rect.top + 1);
  const rowEnd = trackAt(geometry.rows, rect.bottom - 1);
  return {
    column: columnStart,
    row: rowStart,
    columnSpan: Math.max(1, columnEnd - columnStart + 1),
    rowSpan: Math.max(1, rowEnd - rowStart + 1),
  };
}

/** The cell under a point; below the last row of a growing grid, the next row. */
export function cellAt(geometry: Geometry, x: number, y: number): Cell {
  return {
    column: trackAt(geometry.columns, x),
    row: trackAt(geometry.rows, y, !geometry.fixedRows),
  };
}

export function areaRect(geometry: Geometry, area: Area): DOMRect {
  const c0 = geometry.columns[area.column - 1] ?? geometry.columns[geometry.columns.length - 1];
  const c1 =
    geometry.columns[area.column + area.columnSpan - 2] ??
    geometry.columns[geometry.columns.length - 1];
  const rowHeight = averageTrack(geometry.rows);
  const r0 = geometry.rows[area.row - 1] ?? {
    start: (geometry.rows[geometry.rows.length - 1]?.end ?? geometry.rect.top) + geometry.rowGap,
    end:
      (geometry.rows[geometry.rows.length - 1]?.end ?? geometry.rect.top) +
      geometry.rowGap +
      rowHeight,
  };
  const lastRow = area.row + area.rowSpan - 2;
  const r1 = geometry.rows[lastRow] ?? {
    start: r0.start,
    end: r0.start + (lastRow - (area.row - 1)) * (rowHeight + geometry.rowGap) + rowHeight,
  };
  const left = c0?.start ?? geometry.rect.left;
  const right = c1?.end ?? geometry.rect.right;
  return new DOMRect(left, r0.start, right - left, r1.end - r0.start);
}

function gridColumns(meta: PreviewMeta, list: FieldPath, geometry: Geometry): number {
  return meta.grids[list.join('.')]?.[breakpoint()].columns ?? geometry.columns.length;
}

function gridRows(meta: PreviewMeta, list: FieldPath): number | undefined {
  return meta.grids[list.join('.')]?.[breakpoint()].rows;
}

/** Clamps an area to the editor's declared grid, not the page's CSS. */
export function clampArea(
  meta: PreviewMeta,
  list: FieldPath,
  geometry: Geometry,
  area: Area,
): Area {
  const columns = gridColumns(meta, list, geometry);
  const rows = gridRows(meta, list);
  const columnSpan = Math.max(1, Math.min(area.columnSpan, columns));
  const rowSpan = Math.max(1, rows ? Math.min(area.rowSpan, rows) : area.rowSpan);
  return {
    column: Math.max(1, Math.min(area.column, columns - columnSpan + 1)),
    row: Math.max(1, rows ? Math.min(area.row, rows - rowSpan + 1) : area.row),
    columnSpan,
    rowSpan,
  };
}

export function sameArea(a: Area, b: Area): boolean {
  return (
    a.column === b.column &&
    a.row === b.row &&
    a.columnSpan === b.columnSpan &&
    a.rowSpan === b.rowSpan
  );
}

/** A resolved `grid-template-*` value as viewport offsets, implicit rows included. */
export function tracks(template: string, start: number, gap: number): Track[] {
  const sizes = template
    .split(' ')
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  const out: Track[] = [];
  let position = start;
  for (const size of sizes) {
    out.push({ start: position, end: position + size });
    position += size + gap;
  }
  return out;
}

/** The 1-based track at a coordinate, gaps going to the nearer; `beyond` allows one extra. */
export function trackAt(list: Track[], position: number, beyond = false): number {
  if (list.length === 0) return 1;
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index] as Track;
    const next = list[index + 1];
    const boundary = next ? (track.end + next.start) / 2 : track.end;
    if (position < boundary) return index + 1;
  }
  return beyond ? list.length + 1 : list.length;
}

function averageTrack(list: Track[]): number {
  if (list.length === 0) return 80;
  const total = list.reduce((sum, track) => sum + (track.end - track.start), 0);
  return Math.max(24, total / list.length);
}
