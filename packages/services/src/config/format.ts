import {
  type ContentTypeDefinition,
  type CredentialDefinitionInput,
  parseCodeRef,
  type TemplateDefinitionInput,
} from '@manablox/core';

/**
 * Renders a space's admin-built model as `manablox.config.ts` source. Omits ids (derived
 * from slugs) and secrets; credentials render as empty slots.
 */
export const CONFIG_KINDS = ['contentTypes', 'credentials', 'templates'] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** The `define*` call each kind is written with, and the export it lands in. */
const KIND_SPECS: Record<
  ConfigKind,
  { fn: string; collection: string; resource: boolean; fallback: string }
> = {
  contentTypes: {
    fn: 'defineContentType',
    collection: 'contentTypes',
    resource: false,
    fallback: 'type',
  },
  credentials: {
    fn: 'defineCredential',
    collection: 'credentials',
    resource: true,
    fallback: 'credential',
  },
  templates: {
    fn: 'defineTemplate',
    collection: 'templates',
    resource: true,
    fallback: 'template',
  },
};

/** Declarations in their `define*` input shape; references are `ref.*` markers. */
export interface ConfigSource {
  contentTypes?: readonly ContentTypeDefinition[];
  credentials?: readonly CredentialDefinitionInput[];
  templates?: readonly TemplateDefinitionInput[];
  /** Entries of plugin resource kinds, written under `resources.plugins`. */
  plugins?: readonly ConfigPluginKind[];
}

/** A plugin resource kind's entries, from a data provider's `configExport`. */
export interface ConfigPluginKind {
  /** `<plugin id>.<name>`. */
  kind: string;
  /** The function each entry is written with, and its module. */
  define: { name: string; from: string };
  entries: readonly { slug: string; input: unknown }[];
}

/** A header note above the imports. */
export interface ConfigSourceHeader {
  spaceName: string;
  /** Slugs of declarations the space holds but that could not be rendered whole. */
  warnings?: readonly string[];
}

export function renderConfigSource(source: ConfigSource, header?: ConfigSourceHeader): string {
  const kinds = CONFIG_KINDS.filter((kind) => source[kind] !== undefined);
  const names = new NameSet();

  // One pass over every kind: constants share a module scope.
  const declared = kinds.map((kind) => ({
    kind,
    entries: (source[kind] ?? []).map((entry) => ({
      constant: names.take(slugOf(entry, kind), KIND_SPECS[kind].fallback),
      value: toLiteralInput(entry, kind),
    })),
  }));

  const pluginKinds = (source.plugins ?? []).map((entry) => ({
    ...entry,
    entries: entry.entries.map(({ slug, input }) => ({
      constant: names.take(slug, entry.kind.slice(entry.kind.indexOf('.') + 1)),
      value: input,
    })),
  }));

  // `ref` is imported only when used.
  const references = [...declared, ...pluginKinds].some(({ entries }) =>
    entries.some(({ value }) => holdsRef(value)),
  );
  const imports = [
    ...kinds.map((kind) => KIND_SPECS[kind].fn),
    ...(references ? ['ref'] : []),
  ].sort();
  // Other modules' define functions, one import line per module.
  const modules = new Map<string, Set<string>>();
  for (const { define } of pluginKinds) {
    modules.set(define.from, (modules.get(define.from) ?? new Set()).add(define.name));
  }

  const blocks = [
    ...declared.flatMap(({ kind, entries }) =>
      entries.map(
        ({ constant, value }) =>
          `export const ${constant} = ${KIND_SPECS[kind].fn}(${literal(value, 0)});`,
      ),
    ),
    ...pluginKinds.flatMap(({ define, entries }) =>
      entries.map(
        ({ constant, value }) => `export const ${constant} = ${define.name}(${literal(value, 0)});`,
      ),
    ),
  ];

  const list = (kind: ConfigKind) =>
    `[${(declared.find((entry) => entry.kind === kind)?.entries ?? [])
      .map(({ constant }) => constant)
      .join(', ')}]`;

  const collections: string[] = [];
  if (source.contentTypes) collections.push(`export const contentTypes = ${list('contentTypes')};`);
  const resources = kinds.filter((kind) => KIND_SPECS[kind].resource);
  const withEntries = pluginKinds.filter(({ entries }) => entries.length);
  if (resources.length || withEntries.length) {
    collections.push(
      [
        'export const resources = {',
        ...resources.map((kind) => `  ${KIND_SPECS[kind].collection}: ${list(kind)},`),
        ...(withEntries.length
          ? [
              '  plugins: {',
              ...withEntries.map(
                ({ kind, entries }) =>
                  `    '${quoted(kind)}': [${entries.map(({ constant }) => constant).join(', ')}],`,
              ),
              '  },',
            ]
          : []),
        '};',
      ].join('\n'),
    );
  }

  return [
    ...(header ? [...comment(header), ''] : []),
    ...(imports.length ? [`import { ${imports.join(', ')} } from '@manablox/core';`] : []),
    ...[...modules]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, fns]) => `import { ${[...fns].sort().join(', ')} } from '${quoted(from)}';`),
    '',
    ...blocks.flatMap((block) => [block, '']),
    ...collections.flatMap((block) => [block, '']),
  ]
    .join('\n')
    .replace(/\n+$/, '\n');
}

/** Renders content types only. */
export function renderContentTypeConfig(types: readonly ContentTypeDefinition[]): string {
  return renderConfigSource({ contentTypes: types });
}

function comment(header: ConfigSourceHeader): string[] {
  return [
    '/**',
    ` * Generated from the "${header.spaceName}" space. Drop it into a manablox.config.ts,`,
    ' * or import from it, to keep this model in code.',
    ' *',
    ' * Ids are left out on purpose: they are derived from the names and slugs below.',
    ' * Secrets are left out because they cannot travel - a credential is the slot only,',
    ' * for `values` to be filled from the environment.',
    ...(header.warnings?.length
      ? [' *', ...header.warnings.map((warning) => ` * TODO: ${warning}`)]
      : []),
    ' */',
  ];
}

/** A content type's name, otherwise the slug. */
function slugOf(entry: unknown, kind: ConfigKind): string {
  const record = entry as { name?: unknown; slug?: unknown };
  const source = kind === 'contentTypes' ? record.name : record.slug;
  return typeof source === 'string' ? source : '';
}

/** A content type arrives as a full definition; the rest are already inputs. */
function toLiteralInput(entry: unknown, kind: ConfigKind): unknown {
  return kind === 'contentTypes' ? contentTypeInput(entry as ContentTypeDefinition) : entry;
}

/** The definition minus what `defineContentType` derives. */
function contentTypeInput(type: ContentTypeDefinition): Record<string, unknown> {
  return {
    name: type.name,
    label: type.label,
    ...(type.description ? { description: type.description } : {}),
    ...(type.icon ? { icon: type.icon } : {}),
    kind: type.kind,
    ...typeFlags(type),
    fields: type.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      ...(Object.keys(field.settings).length ? { settings: field.settings } : {}),
      ...(field.required ? { required: true } : {}),
      ...(field.localized ? { localized: true } : {}),
      ...(field.unique ? { unique: true } : {}),
      ...(field.readRoles ? { readRoles: field.readRoles } : {}),
      ...(field.writeRoles ? { writeRoles: field.writeRoles } : {}),
      admin: field.admin,
    })),
  };
}

/** Block types reject every flag; data types all but publishing. */
function typeFlags(type: ContentTypeDefinition): Record<string, boolean> {
  if (type.kind === 'block') return {};
  const approval = type.requiresApproval ? { requiresApproval: true } : {};
  if (type.kind === 'data') return { isPublishable: type.isPublishable, ...approval };
  return {
    hasSlug: type.hasSlug,
    isPublishable: type.isPublishable,
    isVisibleInTree: type.isVisibleInTree,
    canBeVisibleInMenu: type.canBeVisibleInMenu,
    ...approval,
  };
}

/** Whether a value holds any reference, which decides the `ref` import. */
function holdsRef(value: unknown): boolean {
  if (parseCodeRef(value)) return true;
  if (Array.isArray(value)) return value.some(holdsRef);
  if (value && typeof value === 'object') return Object.values(value).some(holdsRef);
  return false;
}

/** A TypeScript object literal with keys quoted only when needed. */
function literal(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent + 1);
  const closing = '  '.repeat(indent);

  // References print as calls, e.g. `ref.contentType('x')`.
  const reference = parseCodeRef(value);
  if (reference) {
    // A plugin kind is `<id>.<name>`, which is no property of `ref`.
    return reference.kind.includes('.')
      ? `ref.of('${quoted(reference.kind)}', '${quoted(reference.name)}')`
      : `ref.${reference.kind}('${quoted(reference.name)}')`;
  }

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const entries = value.map((entry) => `${pad}${literal(entry, indent + 1)}`);
    return `[\n${entries.join(',\n')},\n${closing}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) => entry !== undefined,
    );
    if (!entries.length) return '{}';
    const rendered = entries.map(
      ([name, entry]) => `${pad}${key(name)}: ${literal(entry, indent + 1)}`,
    );
    return `{\n${rendered.join(',\n')},\n${closing}}`;
  }

  if (typeof value === 'string') return `'${quoted(value)}'`;
  return String(value);
}

/** A single-quoted string with quotes and line breaks escaped. */
const quoted = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // JavaScript treats line separators as line breaks.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** Quotes a key only when it is not a bare identifier. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${quoted(name)}'`;
}

/** Constant names, unique across every kind. */
class NameSet {
  private readonly taken = new Set<string>();

  take(source: string, fallback: string): string {
    const base = identifier(source) || fallback;
    let candidate = base;
    for (let suffix = 2; this.taken.has(candidate); suffix++) {
      candidate = `${base}${suffix}`;
    }
    this.taken.add(candidate);
    return candidate;
  }
}

/** `blog-post` is not a variable name; `blogPost` is. */
function identifier(name: string): string {
  const camel = name.replace(/[-_]+(.)/g, (_, character: string) => character.toUpperCase());
  if (!camel) return '';
  return /^[A-Za-z_$]/.test(camel) ? camel : `type${camel}`;
}
