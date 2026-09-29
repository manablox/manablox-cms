import { describe, expect, it } from 'vitest';
import { insertionIndex, trackAt, tracks } from '../src/controls/hit-test.js';
import {
  breakpointFor,
  fieldAttribute,
  isBlockPath,
  isEditorMessage,
  isPreviewMessage,
  listAttribute,
  PROTOCOL_VERSION,
  parseFieldPath,
  samePath,
} from '../src/protocol.js';

describe('live preview protocol', () => {
  it('rejects a message without the protocol version', () => {
    expect(isEditorMessage({ kind: 'document' })).toBe(false);
    expect(isEditorMessage({ v: 99, kind: 'document' })).toBe(false);
    expect(isEditorMessage({ v: 2, kind: 'document' })).toBe(false);
    expect(isEditorMessage({ v: PROTOCOL_VERSION, kind: 'document' })).toBe(true);
  });

  it('rejects non-objects and nulls rather than throwing', () => {
    for (const value of [null, undefined, 'document', 42, []]) {
      expect(isEditorMessage(value)).toBe(false);
      expect(isPreviewMessage(value)).toBe(false);
    }
  });

  it('round-trips a field path, keeping array indices numeric', () => {
    const path = ['components', 2, 'headline'];
    const attribute = fieldAttribute(path)['data-manablox-field'] as string;
    expect(attribute).toBe('components.2.headline');
    expect(parseFieldPath(attribute)).toEqual(path);
    expect(listAttribute(['components'])['data-manablox-list']).toBe('components');
    expect(parseFieldPath('')).toEqual([]);
  });

  it('tells a block path from a field path', () => {
    expect(isBlockPath(['components', 2])).toBe(true);
    expect(isBlockPath(['components', 0, 'children', 1])).toBe(true);
    expect(isBlockPath(['components', 2, 'headline'])).toBe(false);
    expect(isBlockPath(['title'])).toBe(false);
    expect(samePath(['a', 1], ['a', 1])).toBe(true);
    expect(samePath(['a', 1], ['a', '1'])).toBe(false);
    expect(samePath(null, null)).toBe(true);
  });
});

describe('drop position', () => {
  const box = (top: number, left: number, width = 100, height = 50) => ({
    getBoundingClientRect: () => ({ top, left, width, height }) as DOMRect,
  });

  it('picks the gap before or after the nearest block in a column', () => {
    const column = [box(0, 0), box(60, 0), box(120, 0)];
    expect(insertionIndex(column, 50, 10)).toBe(0);
    expect(insertionIndex(column, 50, 45)).toBe(1);
    expect(insertionIndex(column, 50, 130)).toBe(2);
    expect(insertionIndex(column, 50, 165)).toBe(3);
    expect(insertionIndex(column, 50, 400)).toBe(3);
  });

  it('reads a row of blocks left to right', () => {
    const row = [box(0, 0), box(0, 110), box(0, 220)];
    expect(insertionIndex(row, 10, 25)).toBe(0);
    expect(insertionIndex(row, 200, 25)).toBe(2);
    expect(insertionIndex(row, 310, 25)).toBe(3);
  });

  it('is the only gap of an empty list', () => {
    expect(insertionIndex([], 0, 0)).toBe(0);
  });
});

describe('grid tracks', () => {
  it('reads resolved templates into viewport offsets', () => {
    expect(tracks('100px 100px 50px', 10, 8)).toEqual([
      { start: 10, end: 110 },
      { start: 118, end: 218 },
      { start: 226, end: 276 },
    ]);
    expect(tracks('none', 0, 0)).toEqual([]);
  });

  it('assigns a coordinate to the nearer track, and past the end to the next one', () => {
    const list = tracks('100px 100px', 0, 10);
    expect(trackAt(list, 50)).toBe(1);
    expect(trackAt(list, 104)).toBe(1);
    expect(trackAt(list, 106)).toBe(2);
    expect(trackAt(list, 500)).toBe(2);
    expect(trackAt(list, 500, true)).toBe(3);
    expect(trackAt([], 5)).toBe(1);
  });

  it('maps widths to the admin device previews', () => {
    expect(breakpointFor(390)).toBe('mobile');
    expect(breakpointFor(820)).toBe('tablet');
    expect(breakpointFor(1280)).toBe('desktop');
  });
});
