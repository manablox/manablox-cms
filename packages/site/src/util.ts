import { fnv1a } from '@manablox/core';

/** Deep copy of JSON data. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with sorted object keys, so equal data always serialises the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Short, CSS-safe hash of a string. */
export function shortHash(input: string): string {
  return fnv1a(input).padStart(8, '0');
}

/** Whether braces in a stylesheet balance, ignoring comments and strings. */
export function cssBracesBalanced(css: string): boolean {
  const stripped = css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  let depth = 0;
  for (const char of stripped) {
    if (char === '{') depth++;
    else if (char === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

/** The value if it is a plain object, else an empty one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
