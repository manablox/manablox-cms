/** Shared vocabulary of code-declared resources: space targets, sources, id refs. Browser-safe. */

export const CODE_RESOURCE_KINDS = ['credential', 'template'] as const;
export type CodeResourceKind = (typeof CODE_RESOURCE_KINDS)[number];

/** An entry of a plugin resource kind; `sourceRef` names the config or plugin declaring it. */
export interface PluginResourceEntry {
  slug: string;
  spaces: SpaceTarget;
  sourceRef?: string;
}

/**
 * A code resource kind a plugin owns, e.g. `website.theme`. `@manablox/services` adds the
 * server side that reconciles entries into rows (`load`, `plan`, `reconcile`, `prune`); a kind
 * without `reconcile` is only read by its plugin.
 */
export interface PluginResourceKind {
  /** Checks every declared entry when the server starts; throw to stop the start. */
  check?(entries: PluginResourceEntry[]): void;
}

/** A `code` row is reconciled from config on sync and read-only elsewhere. */
export const RESOURCE_SOURCES = ['runtime', 'code'] as const;
export type ResourceSource = (typeof RESOURCE_SOURCES)[number];

/** `'*'` is every space, including future ones. */
export type SpaceTarget = '*' | readonly string[];

export const ALL_SPACES = '*';

/** Whether a declaration belongs in the space with this machine name. */
export function targetsSpace(target: SpaceTarget | undefined, machineName: string): boolean {
  if (target === undefined || target === ALL_SPACES) return true;
  return target.includes(machineName);
}

// --- references ----------------------------------------------------------------------

export const CODE_REF_PREFIX = '@manablox:';

export const CODE_REF_KINDS = ['contentType', 'credential', 'template'] as const;
/** A built-in kind, or a plugin resource kind as `<plugin id>.<name>`. */
export type CodeRefKind = (typeof CODE_REF_KINDS)[number] | PluginResourceKindName;
export type PluginResourceKindName = `${string}.${string}`;

export interface CodeRef {
  kind: CodeRefKind;
  /** A content type's name, or another declaration's slug. */
  name: string;
}

const PLUGIN_KIND = /^[a-z][a-z0-9-]*\.[A-Za-z][\w-]*$/;

const makeRef =
  (kind: CodeRefKind) =>
  (name: string): string =>
    `${CODE_REF_PREFIX}${kind}:${name}`;

/**
 * Placeholders for ids a config cannot know; the reconciler resolves them per space, a
 * plugin kind's through the resolver its kind plans.
 */
export const ref = {
  contentType: makeRef('contentType'),
  credential: makeRef('credential'),
  template: makeRef('template'),
  /** An entry of a plugin resource kind: `ref.of('website.theme', 'dark')`. */
  of: (kind: PluginResourceKindName, name: string): string => makeRef(kind)(name),
} as const;

export function parseCodeRef(value: unknown): CodeRef | null {
  if (typeof value !== 'string' || !value.startsWith(CODE_REF_PREFIX)) return null;
  const rest = value.slice(CODE_REF_PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0) return null;
  const kind = rest.slice(0, at) as CodeRefKind;
  const name = rest.slice(at + 1);
  const known = (CODE_REF_KINDS as readonly string[]).includes(kind) || PLUGIN_KIND.test(kind);
  if (!known || !name) return null;
  return { kind, name };
}

export const isCodeRef = (value: unknown): value is string => parseCodeRef(value) !== null;

/** Replaces every reference in a value, returning a fresh structure. */
export function resolveCodeRefs<T>(value: T, resolve: (reference: CodeRef) => string): T {
  return walk(value, resolve) as T;
}

function walk(value: unknown, resolve: (reference: CodeRef) => string): unknown {
  const reference = parseCodeRef(value);
  if (reference) return resolve(reference);
  if (Array.isArray(value)) return value.map((entry) => walk(entry, resolve));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return new Date(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = walk(entry, resolve);
    return out;
  }
  return value;
}

/** Every reference a value holds, deduplicated. */
export function collectCodeRefs(value: unknown, into: CodeRef[] = []): CodeRef[] {
  const reference = parseCodeRef(value);
  if (reference) {
    if (!into.some((seen) => seen.kind === reference.kind && seen.name === reference.name)) {
      into.push(reference);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectCodeRefs(entry, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectCodeRefs(entry, into);
  }
  return into;
}
