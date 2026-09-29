import type {
  PluginResourceEntry,
  PluginResourceKind,
  ResolvedCodeResources,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceEnvironmentRow, SpaceRow } from '@manablox/db';
import type { DataProviderContext } from '../data/provider.js';
import type { ResourcePlan } from './plan.js';
import type { CodeResourceServices, SyncChange, SyncOptions } from './shared.js';

/** What a kind's `configExport.load` gets. */
export interface ConfigExportContext extends DataProviderContext {
  spaceId: string;
}

/** A row that can be written as config: its id, the picker's label and its slug. */
export interface ConfigExportRow<R = unknown> {
  id: string;
  label: string;
  /** The declaration's slug; the label's when empty, made unique across the kind. */
  slug: string;
  row: R;
}

/** What `render` gets besides the row. */
export interface ConfigRenderContext {
  /** The slug the row is written under. */
  slug: string;
  /**
   * `value` with every id the export knows (content types, credentials, templates, other
   * providers' rows) replaced by its `ref.*` marker, at any depth.
   */
  deref<V>(value: V): V;
}

/**
 * Rows the code-first config export (`spaces.configSource`) writes as entries of the resource
 * kind, under `resources.plugins['<kind>']`: the export half of the kind next to its
 * reconcile half.
 */
export interface ResourceConfigExport<R = unknown> {
  /** The config picker's name for the kind, e.g. `Greetings`. */
  label: string;
  /** The picker's line about what is written. */
  description?: string;
  /** The picker's icon, a name of the admin's icon set; `plug` by default. */
  icon?: string;
  /** The function each entry is written with, and the module it is imported from. */
  define: { name: string; from: string };
  /** The space's rows that can be written; leave out rows that came from code. */
  load(context: ConfigExportContext): Promise<ConfigExportRow<R>[]>;
  /** The row as the define function's input, and notes on what it cannot express. */
  render(row: R, context: ConfigRenderContext): { input: unknown; warnings?: string[] };
}

/** What `load` gets: the spaces of one sync pass. */
export interface ResourceLoadContext {
  manablox: Manablox;
  repos: Repositories;
  spaces: SpaceRow[];
}

/** One environment of one space in a sync pass. */
export interface ResourceEnvironmentContext<E = PluginResourceEntry, R = unknown> {
  manablox: Manablox;
  repos: Repositories;
  services: CodeResourceServices;
  space: SpaceRow;
  environment: SpaceEnvironmentRow;
  /** `codeScopeKey`: derived ids of environment rows are keyed on it. */
  key: string;
  /** The kind's declarations that target the space. */
  declared: E[];
  /** What `load` returned for this environment; mutable, so later phases see the writes. */
  rows: R;
}

/** An environment being reconciled, with every kind's plan. */
export interface ResourcePassContext<E = PluginResourceEntry, R = unknown>
  extends ResourceEnvironmentContext<E, R> {
  options: SyncOptions;
  plan: ResourcePlan;
}

/** What a kind plans for one environment before anything is written. */
export interface ResourceKindPlan {
  /** The id `ref.<kind>(name)` stands for after this pass; `undefined` when unknown. */
  resolve(name: string): string | undefined;
}

/** Row lookup per environment, built once per pass. */
export type ResourceRowsOf<R> = (space: SpaceRow, environment: SpaceEnvironmentRow) => R;

/**
 * A kind's `load` from rows per space: each environment gets the rows that belong to it.
 * `rows` is one query over every space of the pass, all environments.
 */
export async function byEnvironment<R extends { environmentId: string }>(
  rows: Promise<Map<string, R[]>>,
): Promise<ResourceRowsOf<R[]>> {
  const bySpace = await rows;
  return (space, environment) =>
    (bySpace.get(space.id) ?? []).filter((row) => row.environmentId === environment.id);
}

declare module '@manablox/core' {
  interface PluginResourceKind {
    /**
     * Reads the kind's rows for every space of a pass in batched queries; the lookup is
     * asked once per environment.
     */
    load?(context: ResourceLoadContext): Promise<ResourceRowsOf<unknown>>;
    /**
     * What the environment will hold after the pass, existing rows plus the declared ones, so
     * other kinds resolve references to this one (and dry runs resolve like real ones).
     */
    plan?(context: ResourceEnvironmentContext): ResourceKindPlan;
    /** Writes the declarations as `source: 'code'` rows; production and every other environment. */
    reconcile?(context: ResourcePassContext): Promise<SyncChange[]>;
    /** Handles code rows whose declaration is gone: disable, delete (`prune`) or release. */
    prune?(context: ResourcePassContext): Promise<SyncChange[]>;
    /** Writes the space's own rows of the kind as declarations; see `ResourceConfigExport`. */
    configExport?: ResourceConfigExport;
  }
}

/** A resource kind with its declarations and rows typed. */
export interface TypedResourceKind<
  E extends PluginResourceEntry,
  R,
  P extends ResourceKindPlan,
  X = unknown,
> {
  check?(entries: E[]): void;
  load?(context: ResourceLoadContext): Promise<ResourceRowsOf<R>>;
  plan?(context: ResourceEnvironmentContext<E, R>): P;
  reconcile?(context: ResourcePassContext<E, R>): Promise<SyncChange[]>;
  prune?(context: ResourcePassContext<E, R>): Promise<SyncChange[]>;
  configExport?: ResourceConfigExport<X>;
}

/** Types a kind's declarations, rows and plan. */
export function defineResourceKind<
  E extends PluginResourceEntry,
  R,
  P extends ResourceKindPlan = ResourceKindPlan,
  X = unknown,
>(kind: TypedResourceKind<E, R, P, X>): PluginResourceKind {
  return kind as PluginResourceKind;
}

/**
 * A kind the host registers with `CodeResourceService` rather than through a plugin, with
 * where its declarations are configured.
 */
export interface HostResourceKind {
  kind: string;
  entries(resources: ResolvedCodeResources): readonly PluginResourceEntry[];
  spec: PluginResourceKind;
}

/** A kind the service reconciles, host or plugin. */
export interface SyncedResourceKind extends HostResourceKind {
  spec: PluginResourceKind & Required<Pick<PluginResourceKind, 'reconcile'>>;
}

/** Host kinds first, in order, then every plugin kind with `reconcile`, in plugin order. */
export function syncedResourceKinds(
  manablox: Pick<Manablox, 'config'>,
  host: readonly HostResourceKind[],
): SyncedResourceKind[] {
  const plugins: HostResourceKind[] = manablox.config.plugins.flatMap((plugin) =>
    Object.entries(plugin.resourceKinds ?? {}).map(([kind, spec]) => ({
      kind,
      entries: (resources: ResolvedCodeResources) => resources.plugins[kind] ?? [],
      spec,
    })),
  );
  return [...host, ...plugins].filter((entry): entry is SyncedResourceKind =>
    Boolean(entry.spec.reconcile),
  );
}
