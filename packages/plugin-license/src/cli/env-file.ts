import { keyId, parseLicenseKey } from '@manablox/license';

/** The variable the keys are listed in. */
export const KEYS_VARIABLE = 'MANABLOX_LICENSE_KEYS';

const LINE = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${KEYS_VARIABLE}[ \\t]*=[ \\t]*)(.*)$`, 'gm');

/** One `MANABLOX_LICENSE_KEYS=` line: where it is and what it lists. */
interface KeysLine {
  start: number;
  end: number;
  prefix: string;
  quote: string;
  /** A comment after an unquoted value, with its leading space. */
  comment: string;
  entries: string[];
}

const split = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** The last line of the variable, which is the one that counts. */
function keysLine(text: string): KeysLine | null {
  let found: KeysLine | null = null;
  for (const match of text.matchAll(LINE)) {
    const [line, prefix = '', raw = ''] = match;
    const quoted = /^(["'])(.*)\1\s*$/.exec(raw);
    const comment = quoted ? '' : (/\s+#.*$/.exec(raw)?.[0] ?? '');
    const value = quoted ? (quoted[2] ?? '') : raw.slice(0, raw.length - comment.length);
    found = {
      start: match.index,
      end: match.index + line.length,
      prefix,
      quote: quoted?.[1] ?? '',
      comment,
      entries: split(value),
    };
  }
  return found;
}

/** The keys a `.env` text lists, normalised; malformed entries are left out. */
export function envKeys(text: string): string[] {
  return (keysLine(text)?.entries ?? []).flatMap((entry) => parseLicenseKey(entry) ?? []);
}

/** The line to put into an environment for `keys`. */
export function keysEntry(keys: readonly string[]): string {
  return `${KEYS_VARIABLE}=${keys.join(',')}`;
}

function replaced(text: string, line: KeysLine, entries: readonly string[]): string {
  const value = `${line.quote}${entries.join(',')}${line.quote}${line.comment}`;
  return `${text.slice(0, line.start)}${line.prefix}${value}${text.slice(line.end)}`;
}

/** `text` with `key` in the list, which is created when missing; unchanged when it is there. */
export function withKey(text: string, key: string): { text: string; changed: boolean } {
  const line = keysLine(text);
  if (!line) {
    const gap = text === '' || text.endsWith('\n') ? '' : '\n';
    return { text: `${text}${gap}${keysEntry([key])}\n`, changed: true };
  }
  if (line.entries.some((entry) => parseLicenseKey(entry) === key)) return { text, changed: false };
  return { text: replaced(text, line, [...line.entries, key]), changed: true };
}

/** `text` without the keys whose id is `id`, and the keys it took out. */
export function withoutKey(text: string, id: string): { text: string; removed: string[] } {
  const line = keysLine(text);
  if (!line) return { text, removed: [] };
  const matches = (entry: string) => {
    const key = parseLicenseKey(entry);
    return key !== null && keyId(key) === id;
  };
  const removed = line.entries.filter(matches);
  if (!removed.length) return { text, removed: [] };
  return {
    text: replaced(
      text,
      line,
      line.entries.filter((entry) => !matches(entry)),
    ),
    removed,
  };
}
