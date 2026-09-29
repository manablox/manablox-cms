import { randomBytes } from 'node:crypto';

/**
 * License keys: `MBX-` and 25 Crockford base32 symbols in groups of five. The first 24
 * symbols carry 120 random bits; the last one is a CRC-5 of those bits. The key is an
 * opaque secret and describes nothing; the license server looks it up.
 *
 * Checksum: CRC-5 with the polynomial x^5 + x^2 + 1 (0x05), register starting at 0, fed
 * the 120 data bits most significant first (each symbol's 5 bits, symbol by symbol), no
 * reflection and no final XOR. A symbol replaced by any other is an error burst of at most
 * 5 bits, which a degree-5 CRC always detects; two swapped or changed symbols slip through
 * about once in 16 to 32.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'MBX';
const GROUPS = 5;
const GROUP_LENGTH = 5;
const DATA_SYMBOLS = GROUPS * GROUP_LENGTH - 1;
const POLYNOMIAL = 0x05;

/** Crockford's reading of look-alike letters, so a key read aloud or retyped still parses. */
const ALIASES: Record<string, string> = { I: '1', L: '1', O: '0' };

function checksum(symbols: readonly number[]): number {
  let crc = 0;
  for (const symbol of symbols) {
    for (let bit = 4; bit >= 0; bit--) {
      const feedback = ((crc >> 4) ^ (symbol >> bit)) & 1;
      crc = (crc << 1) & 0x1f;
      if (feedback) crc ^= POLYNOMIAL;
    }
  }
  return crc;
}

function format(symbols: readonly number[]): string {
  const text = symbols.map((symbol) => ALPHABET[symbol]).join('');
  const groups = [];
  for (let at = 0; at < text.length; at += GROUP_LENGTH)
    groups.push(text.slice(at, at + GROUP_LENGTH));
  return [PREFIX, ...groups].join('-');
}

/** A new random key. For the license server, which issues them. */
export function generateLicenseKey(): string {
  const bytes = randomBytes((DATA_SYMBOLS * 5) / 8);
  const symbols: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols.push((buffer >> bits) & 0x1f);
    }
    buffer &= (1 << bits) - 1;
  }
  return format([...symbols, checksum(symbols)]);
}

/**
 * The canonical form of a key as someone typed it (any case, spaces and dashes anywhere,
 * the `MBX` prefix optional, `I`/`L`/`O` read as `1`/`0`), or null when it is not a key or
 * its checksum fails, which catches typos before a network call.
 */
export function parseLicenseKey(input: string): string | null {
  let text = input.toUpperCase().replace(/[\s-]/g, '');
  if (text.length === GROUPS * GROUP_LENGTH + PREFIX.length && text.startsWith(PREFIX))
    text = text.slice(PREFIX.length);
  if (text.length !== GROUPS * GROUP_LENGTH) return null;
  const symbols: number[] = [];
  for (const char of text) {
    const symbol = ALPHABET.indexOf(ALIASES[char] ?? char);
    if (symbol === -1) return null;
    symbols.push(symbol);
  }
  const data = symbols.slice(0, DATA_SYMBOLS);
  return checksum(data) === symbols[DATA_SYMBOLS] ? format(symbols) : null;
}

/** The key's first group, the part the admin, the CLI and the portal show. */
export function keyId(key: string): string {
  const parsed = parseLicenseKey(key);
  if (!parsed) throw new Error('Not a license key');
  return parsed.slice(PREFIX.length + 1, PREFIX.length + 1 + GROUP_LENGTH);
}
