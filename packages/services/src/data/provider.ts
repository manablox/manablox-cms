import type {
  AnyLimitKey,
  AnyRetentionKey,
  EnvironmentCreateMode,
  EnvironmentNomination,
  PluginContext,
  PluginDataProvider,
  Scope,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {
  HostVerificationData,
  Repositories,
  SpaceEnvironmentRow,
  UsageSpaces,
} from '@manablox/db';
import type { TransferEntry } from '../transfer/format.js';

/** What every provider callback gets. */
export interface DataProviderContext {
  manablox: Manablox;
  /**
   * Core repositories, bound to the operation's transaction when it has one. Plugin
   * repositories built on them with `databaseContextOf` join it.
   */
  repos: Repositories;
  /** The owning plugin's context, with its `services`; absent for core providers. */
  plugin?: PluginContext;
}

/** Source ids to target ids of an environment copy or promote. */
export interface EnvironmentIds {
  /** The target id; `id` itself when it has none. */
  id(id: string): string;
  has(id: string): boolean;
  /** `value` with every mapped UUID in its strings replaced, at any depth. */
  remap<T>(value: T): T;
}

export interface EnvironmentReadContext extends DataProviderContext {
  spaceId: string;
  environmentId: string;
}

export interface EnvironmentCopyContext<T> extends DataProviderContext {
  spaceId: string;
  from: SpaceEnvironmentRow;
  to: SpaceEnvironmentRow;
  mode: EnvironmentCreateMode;
  /** The source rows under their new ids, an `environmentId` set to `to`. */
  rows: T[];
  ids: EnvironmentIds;
}

export interface EnvironmentPromoteContext<T> extends DataProviderContext {
  spaceId: string;
  stagingId: string;
  productionId: string;
  /** The staging machine name. */
  environment: string;
  mode: EnvironmentCreateMode;
  /** Staging's rows under production ids, an `environmentId` set to production. */
  upsert: T[];
  /** Production rows no staged row replaces. */
  remove: T[];
  /** Production's rows before the promote. */
  production: T[];
  ids: EnvironmentIds;
}

/** What a promote changes, for limit checks. */
export interface EnvironmentPromoteChange<T> {
  upsert: T[];
  remove: T[];
  production: T[];
}

/**
 * Rows of an environment that copies and promotes move. Row ids follow the environment like
 * core ids: a copy gives each row a derived id, a promote maps it back to its source.
 */
export interface EnvironmentDataProvider<T extends { id: string } = { id: string }> {
  /** The promote group, diff kind and copy count; the provider kind by default. */
  key?: string;
  /**
   * Keys of other providers' groups this one's promote runs after, and its diff lines follow;
   * missing ones are ignored. Provider groups run after core's config and content groups.
   */
  after?: string[];
  /** Moved by full copies and promotes only, like documents. */
  content?: boolean;
  /** The environment's rows. */
  load(context: EnvironmentReadContext): Promise<T[]>;
  /** A key that matches a staging row to a production row not copied from it. */
  match?(row: T, ids: EnvironmentIds): string | null;
  /** Production rows a promote keeps although staging lacks them, e.g. rows from code. */
  keep?(row: T): boolean;
  /** Whether a staging row is promoted; every one by default. Rows from code sync on their own. */
  promotes?(row: T): boolean;
  /** A row in the promote diff: its label and what counts as a change; comes with `promote`. */
  describe?(row: T): { label: string; value: unknown };
  /** Writes the copied rows; runs in the copy's transaction. */
  copy(context: EnvironmentCopyContext<T>): Promise<void>;
  /**
   * Writes production; runs as its own promote group, one transaction. Without it the rows are
   * never promoted: the promote diff and its groups leave the provider out, and `match` only
   * pairs staging's rows with production's for what points at them.
   */
  promote?(context: EnvironmentPromoteContext<T>): Promise<void>;
  /** Count limit increments a promote needs. */
  limits?(change: EnvironmentPromoteChange<T>): Partial<Record<AnyLimitKey, number>>;
  /** Runs in the transaction that deletes a staging environment. */
  remove?(context: EnvironmentReadContext): Promise<void>;
  /** Documents the environment names in space settings, cleared with the document. */
  nominations?: EnvironmentNomination[];
  /**
   * Runs once a change to the space's environments committed: a staging environment created
   * or deleted, a promote that wrote production, or an import that finished. For per-process
   * state kept about the space, e.g. an index of what runs where.
   */
  onLiveChange?(context: EnvironmentLiveChangeContext): void | Promise<void>;
}

/** What changed a space's environments, for `onLiveChange`. */
export type EnvironmentLiveChange = 'create' | 'delete' | 'promote' | 'import';

export interface EnvironmentLiveChangeContext extends DataProviderContext {
  spaceId: string;
  reason: EnvironmentLiveChange;
}

export interface TransferReadContext extends DataProviderContext {
  spaceId: string;
}

export interface TransferExportContext extends TransferReadContext {
  /** Production as the space id, or a staging environment. */
  scope: Scope;
  /**
   * The entries picked in the transfer dialog, by id; every one when absent. Only a provider
   * with `entries` gets it, and exports just those.
   */
  picked?: readonly string[] | undefined;
}

export interface TransferImportContext extends TransferReadContext {
  actorId: string | null;
  /** Shown after the import, e.g. why an entry was skipped. */
  notes: string[];
  /** The ids the import restores, by kind: core sections' and every provider section's. */
  ids: TransferIdMap;
  /**
   * The rows the file carries under a section, restored or not: a core section's (e.g.
   * `credentials`) or a provider's entries; empty when the file has none. Rows a section left
   * behind can be recreated from them, e.g. what a provider's rows point at.
   */
  carried(kind: string): readonly unknown[];
}

/**
 * Kinds of provider sections whose restored ids other providers read, by kind; the owning
 * package augments it: `interface TransferIdKinds { 'hello.greetings': true }`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by plugin packages
export interface TransferIdKinds {}

/** A core section holding rows with ids, or a provider kind. */
export type TransferIdKind =
  | 'contentTypes'
  | 'contents'
  | 'assets'
  | 'menus'
  | 'roles'
  | 'credentials'
  | keyof TransferIdKinds
  | (string & Record<never, never>);

/** The rows an import restores, shared by every section of it. */
export interface TransferIdMap {
  /**
   * Export ids of the kind's restored rows to the ids they are written under, whether or not
   * their step ran yet; empty for a kind the import leaves out. Core rows keep their ids (a
   * snapshot restored beside its space is remapped before); a provider's come from its `ids`
   * and `targetId`.
   */
  of(kind: TransferIdKind): ReadonlyMap<string, string>;
}

/** A section of the space export: `plugins.<kind>` in the file, a list of JSON entries. */
export interface TransferDataProvider<E = unknown> {
  section: {
    label: string;
    /**
     * Kinds whose entries this one references: other providers' kinds, whose imports then run
     * first, or core sections (`contentTypes`, `credentials`, ...), which always import before
     * provider sections. Kinds that are not there are ignored; a cycle stops the start.
     */
    dependsOn?: TransferIdKind[];
    /** Exported by default but only imported when named. */
    optIn?: boolean;
  };
  /** Entries the space holds, for the transfer dialog. */
  count(context: TransferReadContext): Promise<number>;
  /**
   * The space's entries by id and name, so the transfer dialog can pick them one by one:
   * `export` then gets the picked ids as `picked`, and an import keeps only the file's entries
   * whose `id` was picked.
   */
  entries?(context: TransferReadContext): Promise<TransferEntry[]>;
  export(context: TransferExportContext): Promise<E[]>;
  /** Row ids the entries keep, so a snapshot restored beside its space gets fresh ones. */
  ids?(entries: E[]): string[];
  /**
   * The id the row of the entry with id `id` is written under, for an import that does not
   * keep ids; deterministic (e.g. `stableId(spaceId, id)`), so every step of an import,
   * resumed or not, agrees. The import's `ids` map uses it.
   */
  targetId?(id: string, spaceId: string): string;
  /** What importing the entries counts against each count limit. */
  limits?(entries: E[]): Partial<Record<AnyLimitKey, number>>;
  /** Runs before anything is written, e.g. `before...` hooks; throw to refuse the import. */
  check?(context: TransferReadContext, entries: E[]): Promise<void>;
  /** Writes the entries into the new space, one transaction. */
  import(context: TransferImportContext, entries: E[]): Promise<void>;
}

/** Rows a retention control lets go. */
export interface RetentionDataProvider {
  key: AnyRetentionKey;
  /** Deletes up to about `limit` rows the space's value lets go; returns how many. */
  prune(
    context: DataProviderContext & { spaceId: string; limit: number },
    value: number,
  ): Promise<number>;
}

/** A snapshot restored on the instance it was taken on, as the source's secrets carry over. */
export interface CredentialsRestoredContext<E = unknown, D = unknown> extends DataProviderContext {
  /** The restored space; `repos` is the transaction that carries the secrets. */
  spaceId: string;
  /** The space the snapshot was taken of. */
  sourceSpaceId: string;
  /** Snapshot ids to the restored rows' ids; ids the restore kept are absent. */
  ids: ReadonlyMap<string, string>;
  /** The provider's transfer entries in the snapshot, under their snapshot ids. */
  entries: E[];
  /** The provider's snapshot data, when it keeps any. */
  data: D | undefined;
}

/**
 * State of a space a snapshot keeps beside the export, e.g. rows the export leaves out. Its
 * UUIDs are remapped like the export's when restored beside the space. `capture` and `restore`
 * come together; a provider may declare only `afterCredentialsRestored`.
 */
export interface SnapshotDataProvider<D = unknown, E = unknown> {
  /** Runs while the snapshot is taken, after the export. */
  capture?(context: TransferReadContext): Promise<D>;
  /** Row ids the data keeps, so a snapshot restored beside its space gets fresh ones. */
  ids?(data: D): string[];
  /** What restoring the data counts against each count limit. */
  limits?(data: D): Partial<Record<AnyLimitKey, number>>;
  /** Writes the data into the restored space, as one import step after the sections. */
  restore?(context: TransferImportContext, data: D): Promise<void>;
  /**
   * Exports leave secrets out; a restore on the same instance carries the credential secrets
   * over from the source space's rows, and here a provider carries its own, such as API keys.
   * Runs in that transaction; `sealed` holds the snapshot ids of the credentials whose secrets
   * came back, e.g. to switch on again what needs them.
   */
  afterCredentialsRestored?(
    context: CredentialsRestoredContext<E, D>,
    sealed: ReadonlySet<string>,
  ): Promise<void>;
}

/** Rows of `spaceIds` (every space for `all`) a count limit counts; staging rows never count. */
export type DataCounter = (context: DataProviderContext, spaceIds: UsageSpaces) => Promise<number>;

/** A row of host names. */
export interface HostRow extends HostVerificationData {
  id: string;
  spaceId: string;
  environmentId: string;
  hostname: string;
  createdAt: Date;
}

/** A table of host names, verified by DNS and unique across every source. */
export interface HostSource<R extends HostRow = HostRow> {
  /** The `kind` of `domain.*` events, e.g. `api`. */
  kind: string;
  /** Purged when one of its hosts changes. */
  cacheTag: string;
  find(repos: Repositories, hostname: string): Promise<R | null>;
  /** Unverified rows still in their window, least recently checked first. */
  pending(repos: Repositories, limit: number): Promise<R[]>;
  setVerification(
    repos: Repositories,
    id: string,
    data: Partial<HostVerificationData>,
  ): Promise<R | null>;
  /** Hands a space's production hosts to another space; returns how many moved. */
  moveSpace(repos: Repositories, fromSpaceId: string, toSpaceId: string): Promise<number>;
  /** Fields its `domain.*` events add, e.g. a locale. */
  eventFields?(row: R): Record<string, unknown>;
  /** A space's rows, for the control API's space view. */
  listBySpace?(repos: Repositories, spaceId: string): Promise<R[]>;
  /** Fields the control API's space view adds, e.g. a locale. */
  viewFields?(row: R): { locale?: string | null; isPrimary?: boolean };
}

/** A provider with its parts typed by row, entry and snapshot data. */
export interface TypedDataProvider<T extends { id: string }, E, D = unknown> {
  kind: string;
  environments?: EnvironmentDataProvider<T>;
  transfer?: TransferDataProvider<E>;
  snapshot?: SnapshotDataProvider<D, E>;
  retention?: RetentionDataProvider[];
  counters?: Partial<Record<AnyLimitKey, DataCounter>>;
  hosts?: HostSource;
  /** Tags purged with a space's caches, e.g. on a promote or a blocked space. */
  cacheTags?(spaceId: string): string[];
}

declare module '@manablox/core' {
  interface PluginDataProvider {
    environments?: EnvironmentDataProvider;
    transfer?: TransferDataProvider;
    snapshot?: SnapshotDataProvider;
    retention?: RetentionDataProvider[];
    /**
     * Counters of core count limits, added to core's, and of the plugin's own limits, which
     * each need one.
     */
    counters?: Partial<Record<AnyLimitKey, DataCounter>>;
    hosts?: HostSource;
    cacheTags?(spaceId: string): string[];
  }
}

/** Types a provider's rows, entries and snapshot data. */
export function defineDataProvider<T extends { id: string }, E, D = unknown>(
  provider: TypedDataProvider<T, E, D>,
): PluginDataProvider {
  return provider as PluginDataProvider;
}
