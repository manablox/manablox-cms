import { describe, expect, it } from 'vitest';
import { generateLicenseKey, keyId, parseLicenseKey } from '../src/index.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A key made by generateLicenseKey, frozen so a checksum change breaks the test. */
const KEY = 'MBX-J06NP-P83GH-JX2NX-6ZWSQ-Z9ZDE';

/** The key with the symbol at `index` (0-24, dashes not counted) replaced. */
function withSymbol(key: string, index: number, symbol: string): string {
  const symbols = key.slice(4).replaceAll('-', '');
  return `MBX-${symbols.slice(0, index)}${symbol}${symbols.slice(index + 1)}`;
}

describe('license keys', () => {
  it('generates keys in the MBX format that parse as themselves', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const key = generateLicenseKey();
      expect(key).toMatch(/^MBX(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
      expect(parseLicenseKey(key)).toBe(key);
      keys.add(key);
    }
    expect(keys.size).toBe(200);
  });

  it('accepts a frozen key and normalises how it was typed', () => {
    expect(parseLicenseKey(KEY)).toBe(KEY);
    expect(parseLicenseKey(' mbx-j06np p83gh-jx2nx 6zwsq-z9zde ')).toBe(KEY);
    expect(parseLicenseKey('J06NPP83GHJX2NX6ZWSQZ9ZDE')).toBe(KEY);
    // Crockford reads O as 0 and I, L as 1.
    expect(parseLicenseKey('MBX-JO6NP-P83GH-JX2NX-6ZWSQ-Z9ZDE')).toBe(KEY);
  });

  it('rejects every single-symbol typo', () => {
    const symbols = KEY.slice(4).replaceAll('-', '');
    for (let index = 0; index < 25; index++) {
      for (const symbol of ALPHABET) {
        if (symbol === symbols[index]) continue;
        expect(parseLicenseKey(withSymbol(KEY, index, symbol))).toBeNull();
      }
    }
  });

  it('rejects adjacent swaps', () => {
    const symbols = KEY.slice(4).replaceAll('-', '');
    // J06NP → 0J6NP, P83GH → 8P3GH: two swaps the checksum catches.
    for (const index of [0, 5]) {
      const pair = symbols.slice(index, index + 2);
      const swapped = withSymbol(withSymbol(KEY, index, pair.charAt(1)), index + 1, pair.charAt(0));
      expect(parseLicenseKey(swapped)).toBeNull();
    }
  });

  it('rejects wrong lengths, prefixes and symbols', () => {
    expect(parseLicenseKey('')).toBeNull();
    expect(parseLicenseKey(KEY.slice(0, -1))).toBeNull();
    expect(parseLicenseKey(`${KEY}0`)).toBeNull();
    expect(parseLicenseKey(KEY.replace('MBX', 'MBY'))).toBeNull();
    expect(parseLicenseKey(withSymbol(KEY, 3, 'U'))).toBeNull();
  });

  it('gives the first group as the key id', () => {
    expect(keyId(KEY)).toBe('J06NP');
    expect(keyId('mbx j06np p83gh jx2nx 6zwsq z9zde')).toBe('J06NP');
    expect(() => keyId('MBX-NOPE')).toThrow();
  });
});
