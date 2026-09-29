import {
  type ContentTypeDefinition,
  type CredentialDefinitionInput,
  humanise,
  ManabloxError,
  ref,
  slugify,
  TEMPLATE_BLOCKS_FIELD,
  TEMPLATE_TYPE_NAME,
  type TemplateBlocksInput,
  type TemplateDefinitionInput,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow, Repositories } from '@manablox/db';
import { type ConfigExportProvider, configExportProviders } from '../data/registry.js';
import { runtimeOnly } from '../transfer/format.js';
import {
  CONFIG_KINDS,
  type ConfigKind,
  type ConfigPluginKind,
  type ConfigSource,
  renderConfigSource,
} from './format.js';

/** A core kind, or a plugin resource kind with a `configExport`. */
export type ConfigSelectionKind = ConfigKind | (string & Record<never, never>);

/** What to render: whole kinds, or named entries within them. */
export interface ConfigSelection {
  kinds?: readonly ConfigSelectionKind[] | undefined;
  /** Row ids per kind; absent means every entry of that kind. */
  ids?: Partial<Record<ConfigSelectionKind, readonly string[] | undefined>> | undefined;
}

export interface ConfigSourceResult {
  code: string;
  /** Per core kind and per provider kind. */
  counts: Record<ConfigKind, number> & Record<string, number>;
}

/** A provider kind in the config picker. */
export interface ConfigInventoryKind {
  /** The data provider's kind, as a selection names it. */
  kind: string;
  label: string;
  description: string | null;
  /** The admin's icon name; `null` for the default. */
  icon: string | null;
  entries: Array<{ id: string; label: string }>;
}

/** What a space may render: entries per core kind, and the providers' kinds. */
export type ConfigInventory = Record<ConfigKind, Array<{ id: string; label: string }>> & {
  plugins: ConfigInventoryKind[];
};

/** Renders a space's admin-built model as `manablox.config.ts`; config-owned rows are skipped. */
export class SpaceConfigService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {}

  async source(spaceId: string, selection: ConfigSelection = {}): Promise<ConfigSourceResult> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });

    const providers = configExportProviders(this.manablox);
    const wanted = new Set<ConfigSelectionKind>(
      selection.kinds ?? [...CONFIG_KINDS, ...providers.map(({ kind }) => kind)],
    );
    const chosen = (kind: ConfigSelectionKind) => selection.ids?.[kind];
    const keep = <T extends { id: string }>(kind: ConfigSelectionKind, rows: T[]): T[] => {
      const ids = chosen(kind);
      return ids ? rows.filter((row) => ids.includes(row.id)) : rows;
    };

    // All declarations are read so references to unpicked ones still resolve.
    const [credentialRows, templateRows, providerRows] = await Promise.all([
      this.repos.credentials.listBySpace(spaceId),
      this.templates(spaceId),
      this.providerRows(providers, spaceId),
    ]);

    // Slugs first, so declarations and references agree.
    const templateSlugs = slugsFor(
      templateRows.map((group) => ({ id: group.localizationId, slug: '', name: group.title })),
    );
    const references = new Map<string, string>([
      ...this.manablox.contentTypes
        .forSpace(spaceId)
        .map((type) => [type.id as string, ref.contentType(type.name)] as const),
      ...credentialRows.map((row) => [row.id, ref.credential(row.slug)] as const),
      ...templateRows.map(
        (group) =>
          [
            group.localizationId,
            ref.template(templateSlugs.get(group.localizationId) as string),
          ] as const,
      ),
      ...providerRows.flatMap(({ provider, rows }) =>
        rows.map((row) => [row.id, ref.of(provider.kind, row.slug)] as const),
      ),
    ]);
    const deref = <T>(value: T): T => replaceIds(value, references) as T;

    const source: ConfigSource = {};
    const counts = Object.fromEntries(
      [...CONFIG_KINDS, ...providers.map(({ kind }) => kind)].map((kind) => [kind, 0]),
    ) as ConfigSourceResult['counts'];
    const warnings: string[] = [];

    if (wanted.has('contentTypes')) {
      const types = keep(
        'contentTypes',
        this.manablox.contentTypes
          .forSpace(spaceId)
          .filter((type) => type.source !== 'code') as Array<
          ContentTypeDefinition & { id: string }
        >,
      );
      source.contentTypes = types;
      counts.contentTypes = types.length;
    }
    if (wanted.has('credentials')) {
      const rows = keep('credentials', runtimeOnly(credentialRows));
      source.credentials = rows.map(
        (row): CredentialDefinitionInput => ({
          slug: row.slug,
          kind: row.kind,
          ...(row.name === humanise(row.slug) ? {} : { name: row.name }),
          ...(row.provider ? { provider: row.provider } : {}),
        }),
      );
      counts.credentials = rows.length;
      // The secret is sealed per instance.
      if (rows.some((row) => row.data)) {
        warnings.push(
          "fill each credential's `values` from the environment; secrets do not travel",
        );
      }
    }
    if (wanted.has('templates')) {
      const groups = templateRows.filter((group) => {
        const ids = chosen('templates');
        return ids ? ids.includes(group.localizationId) : true;
      });
      source.templates = groups.map(
        (group): TemplateDefinitionInput => ({
          slug: templateSlugs.get(group.localizationId) as string,
          title: group.title,
          blocks: deref(group.blocks),
          ...(group.publish ? {} : { publish: false }),
        }),
      );
      counts.templates = groups.length;
    }
    const plugins: ConfigPluginKind[] = [];
    for (const { provider, rows } of providerRows) {
      if (!wanted.has(provider.kind)) continue;
      const { define, render } = provider.configExport;
      const picked = keep(provider.kind, rows);
      plugins.push({
        kind: provider.kind,
        define,
        entries: picked.map((row) => {
          const { input, warnings: notes = [] } = render(row.row, { slug: row.slug, deref });
          warnings.push(...notes.map((note) => `${row.slug}: ${note}`));
          return { slug: row.slug, input };
        }),
      });
      counts[provider.kind] = picked.length;
    }
    if (plugins.length) source.plugins = plugins;

    return {
      code: renderConfigSource(source, { spaceName: space.name, warnings }),
      counts,
    };
  }

  /** What a space may render, per kind. */
  async inventory(spaceId: string): Promise<ConfigInventory> {
    const [credentials, templates, providerRows] = await Promise.all([
      this.repos.credentials.listBySpace(spaceId).then(runtimeOnly),
      this.templates(spaceId),
      this.providerRows(configExportProviders(this.manablox), spaceId),
    ]);
    return {
      plugins: providerRows.map(({ provider, rows }) => ({
        kind: provider.kind,
        label: provider.configExport.label,
        description: provider.configExport.description ?? null,
        icon: provider.configExport.icon ?? null,
        entries: rows.map((row) => ({ id: row.id, label: row.label })),
      })),
      contentTypes: this.manablox.contentTypes
        .forSpace(spaceId)
        .filter((type) => type.source !== 'code')
        .map((type) => ({ id: type.id as string, label: type.label })),
      credentials: credentials.map((row) => ({ id: row.id, label: row.name })),
      templates: templates.map((group) => ({ id: group.localizationId, label: group.title })),
    };
  }

  /** Each provider's rows, with slugs made unique within its kind. */
  private async providerRows(providers: ConfigExportProvider[], spaceId: string) {
    return Promise.all(
      providers.map(async (provider) => {
        const loaded = await provider.configExport.load({
          manablox: this.manablox,
          repos: this.repos,
          spaceId,
        });
        const slugs = slugsFor(loaded.map((row) => ({ ...row, name: row.label })));
        return {
          provider,
          rows: loaded.map((row) => ({ ...row, slug: slugs.get(row.id) as string })),
        };
      }),
    );
  }

  /** Templates, one entry per document holding every locale. */
  private async templates(spaceId: string): Promise<TemplateGroup[]> {
    const type = this.manablox.contentTypes.tryGetByName(TEMPLATE_TYPE_NAME, spaceId);
    if (!type) return [];

    const rows: ContentRow[] = [];
    for await (const batch of this.repos.content.batches({
      spaceId,
      typeIds: [type.id as string],
    })) {
      rows.push(...batch);
    }

    const groups = new Map<string, TemplateGroup>();
    for (const row of rows) {
      if (row.source === 'code') continue;
      const blocks = row.fields[TEMPLATE_BLOCKS_FIELD];
      if (!blocks) continue;
      const group = groups.get(row.localizationId) ?? {
        localizationId: row.localizationId,
        title: row.title,
        publish: false,
        blocks: {},
      };
      group.blocks[row.locale] = blocks as TemplateBlocksInput;
      group.publish ||= row.status === 'published';
      groups.set(row.localizationId, group);
    }
    return [...groups.values()];
  }
}

interface TemplateGroup {
  localizationId: string;
  title: string;
  publish: boolean;
  /** One block list per locale, as `defineTemplate` takes. */
  blocks: Record<string, TemplateBlocksInput>;
}

/** A unique slug per row, derived from the name when empty. */
function slugsFor(rows: Array<{ id: string; slug: string; name: string }>): Map<string, string> {
  const slugs = new Map<string, string>();
  const taken = new Set<string>();
  for (const row of rows) {
    const base = row.slug || slugify(row.name) || 'entry';
    let candidate = base;
    for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${base}-${suffix}`;
    taken.add(candidate);
    slugs.set(row.id, candidate);
  }
  return slugs;
}

/** Inverse of `resolveCodeRefs`: known ids become `ref.*` markers, others are kept. */
function replaceIds(value: unknown, references: Map<string, string>): unknown {
  if (typeof value === 'string') return references.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => replaceIds(entry, references));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, replaceIds(entry, references)]),
    );
  }
  return value;
}
