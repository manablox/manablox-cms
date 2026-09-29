import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stableId } from '../src/stable-id.js';

function nodeStableId(namespace: string, name: string): string {
  const bytes = createHash('sha1').update(`manablox:${namespace}:${name}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('stableId', () => {
  it('matches the node:crypto SHA-1 across block boundaries and multibyte input', () => {
    for (let length = 0; length < 140; length++) {
      const name = 'aä€😀'.repeat(length).slice(0, length);
      expect(stableId('field:Article', name)).toBe(nodeStableId('field:Article', name));
    }
  });
});
