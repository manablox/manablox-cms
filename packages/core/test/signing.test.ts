import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sameSignature, signBody } from '../src/signing.node.js';

describe('signBody', () => {
  const hex = createHmac('sha256', 's').update('{"a":1}').digest('hex');

  it('signs as sha256=<hex> by default', () => {
    expect(signBody('s', '{"a":1}')).toBe(`sha256=${hex}`);
  });

  it('takes another algorithm and format', () => {
    expect(signBody('s', '{"a":1}', { format: 'hex' })).toBe(hex);
    expect(signBody('s', 'x', { algorithm: 'sha1', format: 'base64' })).toBe(
      createHmac('sha1', 's').update('x').digest('base64'),
    );
    expect(signBody('s', 'x', { algorithm: 'sha512' })).toMatch(/^sha512=[0-9a-f]{128}$/);
  });
});

describe('sameSignature', () => {
  it('matches equal strings only, whatever their length', () => {
    expect(sameSignature('abc', 'abc')).toBe(true);
    expect(sameSignature('abc', 'abd')).toBe(false);
    expect(sameSignature('abc', 'abcd')).toBe(false);
    expect(sameSignature('', '')).toBe(true);
  });
});
