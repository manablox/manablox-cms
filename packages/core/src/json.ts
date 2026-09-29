/** Helpers for JSON-shaped values. Browser-safe. */

/** Key-order-insensitive deep equality; `jsonb` reorders keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => sameValue(entry, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => sameValue(left[key], right[key]));
}

/** Where JSON may sit in a model's answer: all of it, a fence, or the outermost brackets. */
function jsonCandidates(answer: string): string[] {
  const candidates = [answer];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1];
  if (fenced !== undefined) candidates.push(fenced);
  const first = /[[{]/.exec(answer);
  const last = Math.max(answer.lastIndexOf('}'), answer.lastIndexOf(']'));
  if (first && last > first.index) candidates.push(answer.slice(first.index, last + 1));
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(answer.slice(start, end + 1));
  return candidates;
}

function firstJson<T>(answer: string, accept: (value: unknown) => value is T): T | null {
  for (const candidate of jsonCandidates(answer)) {
    if (!candidate.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      if (accept(parsed)) return parsed;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The JSON object or list in a model's answer, tolerating fences and surrounding prose. */
export const parseJsonAnswer = (answer: string): Record<string, unknown> | unknown[] | null =>
  firstJson(answer, (value): value is Record<string, unknown> | unknown[] =>
    Boolean(value && typeof value === 'object'),
  );

/** The JSON object in a model's answer, tolerating fences and surrounding prose. */
export const parseJsonObject = (answer: string): Record<string, unknown> | null =>
  firstJson(answer, isObject);
