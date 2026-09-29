import type { PlaceholderHint } from './hints';

/** The placeholder being typed at the caret: where its `{{` starts and the path so far. */
export interface PlaceholderQuery {
  start: number;
  query: string;
}

/** An open `{{` before the caret, followed only by path characters. */
const OPEN = /\{\{\s*([\w.<>[\]-]*)$/;

/** The placeholder the caret is in, or null when it is not after an unclosed `{{`. */
export function placeholderQuery(text: string, caret: number): PlaceholderQuery | null {
  const match = OPEN.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: match.index, query: match[1] ?? '' };
}

/** Hints whose path starts with the query first, then those containing it; at most `limit`. */
export function matchHints(
  hints: readonly PlaceholderHint[],
  query: string,
  limit = 50,
): PlaceholderHint[] {
  const wanted = query.toLowerCase();
  const seen = new Set<string>();
  const starts: PlaceholderHint[] = [];
  const contains: PlaceholderHint[] = [];
  for (const hint of hints) {
    if (seen.has(hint.path)) continue;
    const path = hint.path.toLowerCase();
    if (path.startsWith(wanted)) starts.push(hint);
    else if (wanted && path.includes(wanted)) contains.push(hint);
    else continue;
    seen.add(hint.path);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * The text with the placeholder at `start` completed to `path`, closed unless a `}}`
 * already follows, and the selection to set: a `<name>` part selected to type over,
 * else the caret after the placeholder.
 */
export function completePlaceholder(
  text: string,
  caret: number,
  start: number,
  path: string,
): { text: string; selection: [number, number] } {
  const rest = text.slice(caret);
  const closed = /^\s*\}\}/.exec(rest);
  const inserted = `{{ ${path} }}`;
  const after = closed ? rest.slice(closed[0].length) : rest;
  const next = `${text.slice(0, start)}${inserted}${after}`;
  const blank = /<[^>]+>/.exec(path);
  if (blank) {
    const from = start + 3 + blank.index;
    return { text: next, selection: [from, from + blank[0].length] };
  }
  const end = start + inserted.length;
  return { text: next, selection: [end, end] };
}
