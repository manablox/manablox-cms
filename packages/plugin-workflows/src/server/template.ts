/** `{{ path }}` placeholders over the run context. Objects render as JSON, missing as empty. */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;
const LONE_PLACEHOLDER = /^\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}$/;

/** The path of a template that is one placeholder and nothing else. */
export function lonePath(template: string): string | null {
  return LONE_PLACEHOLDER.exec(template.trim())?.[1] ?? null;
}

/** Whether a template is itself JSON, so placeholders in it keep their types. */
export function looksLikeJson(template: string): boolean {
  const trimmed = template.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** A template's value: a lone placeholder or JSON keeps its type, anything else is text. */
export function evaluate(template: string, context: unknown): unknown {
  const path = lonePath(template);
  if (path) return resolvePath(context, path);
  if (looksLikeJson(template)) return JSON.parse(renderJson(template, context));
  return render(template, context);
}

export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (segment === '') continue;
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export function render(template: string, context: unknown): string {
  return template.replace(PLACEHOLDER, (_match, path: string) =>
    stringify(resolvePath(context, path)),
  );
}

/** Renders inside JSON; a lone placeholder in a string becomes the value itself. */
export function renderJson(template: string, context: unknown): string {
  const parsed: unknown = JSON.parse(template);
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const alone = LONE_PLACEHOLDER.exec(value)?.[1];
      if (alone) {
        const resolved = resolvePath(context, alone);
        return resolved === undefined ? null : resolved;
      }
      return render(value, context);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, walk(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(walk(parsed));
}

/** Every placeholder path a template names. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}
