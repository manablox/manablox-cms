/** Small value parsers for control values; issues collect instead of throwing. */

export interface ControlIssue {
  path: (string | number)[];
  message: string;
}

/** Parses a value, pushing issues; the return value only counts when no issue was added. */
export type Parser<T> = (value: unknown, path: (string | number)[], issues: ControlIssue[]) => T;

type Parsed<P> = P extends Parser<infer T> ? T : never;

const fail = <T>(issues: ControlIssue[], path: (string | number)[], message: string): T => {
  issues.push({ path, message });
  return undefined as T;
};

export const boolean = (): Parser<boolean> => (value, path, issues) =>
  typeof value === 'boolean' ? value : fail(issues, path, 'Expected a boolean.');

export const integer =
  (options: { min?: number; max?: number } = {}): Parser<number> =>
  (value, path, issues) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      return fail(issues, path, 'Expected an integer.');
    }
    if (options.min !== undefined && value < options.min) {
      return fail(issues, path, `Expected at least ${options.min}.`);
    }
    if (options.max !== undefined && value > options.max) {
      return fail(issues, path, `Expected at most ${options.max}.`);
    }
    return value;
  };

export const text =
  (options: { min?: number; max: number }): Parser<string> =>
  (value, path, issues) => {
    if (typeof value !== 'string') return fail(issues, path, 'Expected a string.');
    if (value.length < (options.min ?? 0)) return fail(issues, path, 'Too short.');
    if (value.length > options.max) return fail(issues, path, `At most ${options.max} characters.`);
    return value;
  };

/** Tags, comments and doctypes; a lone `<` stays allowed. */
const MARKUP = /<[a-z!/?]/i;

/** Control characters other than tab and line breaks. */
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
  }
  return false;
};

/** Text shown as is: no HTML, no control characters. */
export const plainText =
  (options: { min?: number; max: number }): Parser<string> =>
  (value, path, issues) => {
    const raw = text(options)(value, path, issues);
    if (raw === undefined) return raw;
    if (MARKUP.test(raw)) return fail(issues, path, 'Plain text only, without HTML.');
    if (hasControlCharacter(raw)) return fail(issues, path, 'Contains control characters.');
    return raw;
  };

/** An absolute http(s) URL without credentials. */
export const url = (): Parser<string> => (value, path, issues) => {
  const raw = text({ min: 1, max: 2048 })(value, path, issues);
  if (raw === undefined) return raw;
  const parsed = URL.canParse(raw) ? new URL(raw) : null;
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return fail(issues, path, 'Expected an http(s) URL.');
  }
  return parsed.username || parsed.password
    ? fail(issues, path, 'Expected a URL without credentials.')
    : raw;
};

export const oneOf =
  <const T extends string>(options: readonly T[]): Parser<T> =>
  (value, path, issues) =>
    options.includes(value as T)
      ? (value as T)
      : fail(issues, path, `Expected one of: ${options.join(', ')}.`);

export const nullable =
  <T>(inner: Parser<T>): Parser<T | null> =>
  (value, path, issues) =>
    value === null ? null : inner(value, path, issues);

export const list =
  <T>(item: Parser<T>, options: { min?: number; max: number }): Parser<T[]> =>
  (value, path, issues) => {
    if (!Array.isArray(value)) return fail(issues, path, 'Expected a list.');
    if (value.length < (options.min ?? 0)) {
      return fail(issues, path, `Expected at least ${options.min} entries.`);
    }
    if (value.length > options.max) {
      return fail(issues, path, `Expected at most ${options.max} entries.`);
    }
    return value.map((entry, index) => item(entry, [...path, index], issues));
  };

type Shape = Record<string, Parser<unknown>>;

type ObjectOf<S extends Shape, O extends keyof S> = {
  [K in Exclude<keyof S, O>]: Parsed<S[K]>;
} & { [K in O]?: Parsed<S[K]> };

/** A plain object; keys in `optional` may be absent, unknown keys are refused. */
export const object =
  <S extends Shape, O extends keyof S = never>(
    shape: S,
    optional?: readonly O[],
  ): Parser<NoInfer<{ [K in keyof ObjectOf<S, O>]: ObjectOf<S, O>[K] }>> =>
  (value, path, issues) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(issues, path, 'Expected an object.');
    }
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (!(key in shape)) issues.push({ path: [...path, key], message: 'Unknown property.' });
    }
    for (const [key, parse] of Object.entries(shape)) {
      if (input[key] === undefined) {
        if (!(optional as readonly string[] | undefined)?.includes(key)) {
          issues.push({ path: [...path, key], message: 'Required.' });
        }
        continue;
      }
      out[key] = parse(input[key], [...path, key], issues);
    }
    return out as never;
  };

/** Adds a check on top of a parser. */
export const refine =
  <T>(inner: Parser<T>, check: (value: T) => string | null): Parser<T> =>
  (value, path, issues) => {
    const before = issues.length;
    const parsed = inner(value, path, issues);
    if (issues.length > before) return parsed;
    const message = check(parsed);
    return message ? fail(issues, path, message) : parsed;
  };
