import { describe, expect, it } from 'vitest';
import { CONTENT_TYPE_KINDS, canHoldChildren, canNest, isDocumentType } from '../src/types.js';

describe('content kinds', () => {
  it('tells documents, databags and blocks apart', () => {
    const table = CONTENT_TYPE_KINDS.map((kind) => [
      kind,
      isDocumentType({ kind }),
      canNest({ kind }),
      canHoldChildren({ kind }),
    ]);
    expect(table).toEqual([
      ['content', true, true, true],
      ['block', false, false, false],
      ['data', true, false, false],
    ]);
  });
});
