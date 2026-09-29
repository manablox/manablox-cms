import type { AnyLimitKey } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, TransactionRepositories } from '@manablox/db';
import type {
  SnapshotDataProvider,
  TransferDataProvider,
  TransferIdKind,
  TransferIdMap,
} from '../../data/provider.js';
import { snapshotProviders, transferProviders } from '../../data/registry.js';
import {
  depth,
  type ExportedAsset,
  type ExportedContent,
  type ImportResult,
  keepChosen,
  keepPicked,
  type SelectableSection,
  SPACE_EXPORT_SECTIONS,
  type SpaceExport,
  type SpaceExportSection,
  selectContents,
  type TransferSelection,
} from '../format.js';
import { importAssets } from './assets.js';
import {
  assertTypesKnown,
  importContents,
  recordAssetUsages,
  restoreContentDates,
} from './contents.js';
import { importCredentials } from './credentials.js';
import type { ImportHookRows } from './hooks.js';
import { importRedirects } from './redirects.js';
import { importTags } from './tags.js';

/** Documents per transaction; a chunk stays well under the SQLite busy timeout. */
const CONTENT_BATCH = 250;
/** Assets per transaction. */
const ASSET_BATCH = 500;
/** Documents published, dated and indexed per transaction. */
const PUBLISH_BATCH = 250;

interface ImportStepContext {
  manablox: Manablox;
  tx: TransactionRepositories;
  spaceId: string;
  actorId: string | null;
  /** Filled by the steps, e.g. why an entry was skipped. */
  notes: string[];
}

/** One transaction of an import. */
export interface ImportStep {
  key: string;
  run(context: ImportStepContext): Promise<void>;
  /** Runs once the step committed. */
  committed?(repos: Repositories): Promise<void>;
}

export interface ImportPlan {
  data: SpaceExport;
  steps: ImportStep[];
  /** Every asset restored. */
  assets: ExportedAsset[];
  /** Storage key to mime type of every asset restored. */
  files: Map<string, string>;
  hasContentTypes: boolean;
  /** What the new space brings, per count limit. */
  limits: Partial<Record<AnyLimitKey, number>>;
  /** Rows whose single create runs a `before...` hook. */
  hookRows: ImportHookRows;
  /** Data provider sections restored, in import order. */
  plugins: PluginSection[];
  /** Why sections of the file were skipped. */
  notes: string[];
  result(notes: string[], files: number): ImportResult;
}

/** A data provider section of an import. */
interface PluginSection {
  kind: string;
  transfer: TransferDataProvider;
  entries: unknown[];
}

const chunks = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
};

/**
 * The import as ordered steps. Deterministic for the same file and selection, so a resume
 * rebuilds it and continues at the recorded step.
 */
export function planSpaceImport(
  manablox: Manablox,
  data: SpaceExport,
  selection: TransferSelection,
): ImportPlan {
  const selected = selectImport(manablox, data, selection);
  const { contentTypes, assets, menus, redirects, plugins, snapshots } = selected;
  const providers = providerContext(data, selected);
  const steps = [
    ...coreSteps(manablox, selected),
    ...providerSteps(data, selected, providers),
    ...finishSteps(manablox, selected),
  ];

  return {
    data,
    steps,
    assets,
    files: new Map(assets.map((asset) => [asset.key, asset.mimeType])),
    hasContentTypes: contentTypes.length > 0,
    limits: importLimits(manablox, data, {
      ...selected,
      snapshots: snapshots.map(({ kind, snapshot }) => ({
        snapshot,
        data: data.snapshots?.[kind],
      })),
    }),
    hookRows: { menus, redirects },
    plugins,
    notes: selected.notes,
    result: (notes, files) => importResult(data, selected, notes, files),
  };
}

/** What an import restores, per section, from the file and the selection. */
interface ImportSelection {
  /** Data providers with a transfer section here. */
  known: ReturnType<typeof transferProviders>;
  /** Whether a section is in the file and restored. */
  restore: (section: SpaceExportSection) => boolean;
  withHistory: boolean;
  contentTypes: NonNullable<SpaceExport['contentTypes']>;
  contents: ExportedContent[];
  /** The documents, parents first. */
  ordered: ExportedContent[];
  assets: ExportedAsset[];
  menus: NonNullable<SpaceExport['menus']>;
  roles: NonNullable<SpaceExport['roles']>;
  credentials: NonNullable<SpaceExport['credentials']>;
  redirects: NonNullable<SpaceExport['redirects']>;
  plugins: PluginSection[];
  snapshots: ReturnType<typeof snapshotProviders>;
  /** Sections and snapshot states no plugin here handles. */
  notes: string[];
}

/** The rows each section restores; documents of unknown types refuse the import. */
function selectImport(
  manablox: Manablox,
  data: SpaceExport,
  selection: TransferSelection,
): ImportSelection {
  const known = transferProviders(manablox);
  const optIn = new Set(
    known.filter(({ transfer }) => transfer.section.optIn).map(({ kind }) => kind),
  );
  const held = new Set(data.sections);
  const wanted = new Set(
    selection.sections ?? data.sections.filter((section) => !optIn.has(section)),
  );
  // History needs the documents.
  const restore = (section: SpaceExportSection): boolean =>
    held.has(section) && wanted.has(section) && (section !== 'history' || restore('contents'));
  const take = <T>(section: SpaceExportSection, rows: T[] | undefined): T[] =>
    restore(section) ? (rows ?? []) : [];
  const chosen = (section: SelectableSection) => selection.ids?.[section];

  const contentTypes = keepChosen(
    take('contentTypes', data.contentTypes),
    chosen('contentTypes'),
    (type) => type.id as string,
  );
  const contents = selectContents(take('contents', data.contents), selection.contents);
  // Refused up front, with every missing type named.
  assertTypesKnown(manablox, contents, contentTypes);
  const plugins: PluginSection[] = known.flatMap(({ kind, transfer }) =>
    restore(kind)
      ? [
          {
            kind,
            transfer,
            entries: keepPicked(transfer, data.plugins?.[kind] ?? [], selection.ids?.[kind]),
          },
        ]
      : [],
  );
  const kinds = new Set(known.map(({ kind }) => kind));
  const notes = Object.keys(data.plugins ?? {})
    .filter((kind) => !kinds.has(kind) && restore(kind))
    .map((kind) => `The section ${kind} was skipped: no plugin here handles it.`);
  const snapshotters = snapshotProviders(manablox);
  const snapshotKinds = new Set(snapshotters.map(({ kind }) => kind));
  for (const kind of Object.keys(data.snapshots ?? {})) {
    if (!snapshotKinds.has(kind)) {
      notes.push(`The snapshot state ${kind} was skipped: no plugin here handles it.`);
    }
  }

  return {
    known,
    restore,
    withHistory: restore('history'),
    contentTypes,
    contents,
    // Parents first; children derive path and permalink from them.
    ordered: [...contents].sort((a, b) => depth(a.path) - depth(b.path)),
    assets: take('assets', data.assets),
    menus: keepChosen(take('menus', data.menus), chosen('menus')),
    roles: keepChosen(take('roles', data.roles), chosen('roles')),
    credentials: keepChosen(take('credentials', data.credentials), chosen('credentials')),
    redirects: take('redirects', data.redirects),
    plugins,
    // With its section, or always when the provider has none.
    snapshots: snapshotters.filter(
      ({ kind }) => data.snapshots?.[kind] !== undefined && (restore(kind) || !kinds.has(kind)),
    ),
    notes,
  };
}

/** What provider imports and snapshot restores read besides their own rows. */
function providerContext(
  data: SpaceExport,
  selected: ImportSelection,
): { ids: TransferIdMap; carried: (kind: string) => readonly unknown[] } {
  // Core rows keep their ids; a provider's may be written under derived ones.
  const restoredIds = new Map<string, ReadonlyMap<string, string>>();
  const same = (ids: Iterable<unknown>) =>
    new Map([...ids].flatMap((id) => (typeof id === 'string' ? [[id, id] as const] : [])));
  const core: Array<[TransferIdKind, Array<{ id?: unknown }>]> = [
    ['contentTypes', selected.contentTypes],
    ['contents', selected.contents],
    ['assets', selected.assets],
    ['menus', selected.menus],
    ['roles', selected.roles],
    ['credentials', selected.credentials],
  ];
  for (const [kind, rows] of core) restoredIds.set(kind, same(rows.map((row) => row.id)));
  for (const { kind, transfer, entries } of selected.plugins) {
    const target = (id: string) => transfer.targetId?.(id, data.space.id) ?? id;
    restoredIds.set(kind, new Map((transfer.ids?.(entries) ?? []).map((id) => [id, target(id)])));
  }
  return {
    ids: { of: (kind) => restoredIds.get(kind) ?? new Map() },
    carried: (kind) => {
      const rows = (data as unknown as Record<string, unknown>)[kind] ?? data.plugins?.[kind];
      return Array.isArray(rows) ? rows : [];
    },
  };
}

const step = (
  key: string,
  run: ImportStep['run'],
  committed?: ImportStep['committed'],
): ImportStep => ({ key, run, ...(committed ? { committed } : {}) });

/** Core's sections, content types first. */
function coreSteps(manablox: Manablox, selected: ImportSelection): ImportStep[] {
  const { contentTypes, ordered, assets, menus, roles, credentials, redirects } = selected;
  const steps: ImportStep[] = [];
  if (contentTypes.length) {
    steps.push(
      step(
        'contentTypes',
        async ({ tx, spaceId }) => {
          for (const type of contentTypes) await tx.contentTypes.create({ ...type, spaceId });
        },
        // Documents are validated against them; announced when the import finishes.
        async (repos) => manablox.reload(await repos.contentTypes.listAll(), { synced: true }),
      ),
    );
  }
  chunks(ordered, CONTENT_BATCH).forEach((batch, index) => {
    steps.push(
      step(`contents:${index + 1}`, async ({ tx, spaceId, actorId }) => {
        await importContents(manablox, tx, batch, spaceId, actorId, selected.withHistory);
      }),
    );
  });
  chunks(assets, ASSET_BATCH).forEach((batch, index) => {
    steps.push(
      step(`assets:${index + 1}`, ({ tx, spaceId, actorId }) =>
        importAssets(tx, spaceId, batch, actorId),
      ),
    );
  });
  if (menus.length) {
    // Localization ids are preserved, so the tree is written verbatim.
    steps.push(
      step('menus', async ({ tx, spaceId }) => {
        for (const menu of menus) {
          await tx.menus.create({
            id: menu.id,
            spaceId,
            name: menu.name,
            machineName: menu.machineName,
            description: menu.description,
          });
          await tx.menus.setItems(menu.id, menu.items);
        }
      }),
    );
  }
  if (roles.length) {
    steps.push(
      step('roles', async ({ tx, spaceId }) => {
        for (const role of roles) await tx.roles.create(spaceId, role);
      }),
    );
  }
  // Before provider sections, which may reference credentials by foreign key.
  if (credentials.length) {
    steps.push(
      step('credentials', async ({ tx, spaceId }) => {
        await importCredentials(tx, spaceId, credentials);
      }),
    );
  }
  if (redirects.length) {
    steps.push(
      step('redirects', ({ tx, spaceId, actorId }) =>
        importRedirects(tx, spaceId, redirects, actorId),
      ),
    );
  }
  return steps;
}

/** Provider sections and snapshot states; after core's sections, which their rows may reference. */
function providerSteps(
  data: SpaceExport,
  selected: ImportSelection,
  { ids, carried }: ReturnType<typeof providerContext>,
): ImportStep[] {
  const steps: ImportStep[] = [];
  for (const { kind, transfer, entries } of selected.plugins) {
    if (!entries.length) continue;
    steps.push(
      step(kind, ({ manablox, tx, spaceId, actorId, notes }) =>
        transfer.import({ manablox, repos: tx, spaceId, actorId, notes, ids, carried }, entries),
      ),
    );
  }
  for (const { kind, snapshot } of selected.snapshots) {
    steps.push(
      step(`snapshot:${kind}`, ({ manablox, tx, spaceId, actorId, notes }) =>
        snapshot.restore(
          { manablox, repos: tx, spaceId, actorId, notes, ids, carried },
          data.snapshots?.[kind],
        ),
      ),
    );
  }
  return steps;
}

/** Tags, then publishing, dates and asset usages of the written documents. */
function finishSteps(manablox: Manablox, selected: ImportSelection): ImportStep[] {
  const { contents, assets, ordered } = selected;
  const steps: ImportStep[] = [];
  if (hasTags(contents, assets)) {
    steps.push(
      step('tags', ({ tx, spaceId, actorId }) =>
        importTags(tx, spaceId, contents, assets, actorId),
      ),
    );
  }
  chunks(ordered, PUBLISH_BATCH).forEach((batch, index) => {
    steps.push(
      step(`publish:${index + 1}`, ({ tx, actorId }) =>
        finishContents(manablox, tx, batch, actorId),
      ),
    );
  });
  return steps;
}

/** The summary of a finished import. */
function importResult(
  data: SpaceExport,
  selected: ImportSelection,
  notes: string[],
  files: number,
): ImportResult {
  const { known, restore, contents, plugins } = selected;
  return {
    spaceId: data.space.id,
    sections: [...SPACE_EXPORT_SECTIONS.filter(restore), ...plugins.map(({ kind }) => kind)],
    contentTypes: selected.contentTypes.length,
    contents: contents.length,
    versions: selected.withHistory
      ? contents.reduce((sum, content) => sum + (content.versions?.length ?? 0), 0)
      : 0,
    assets: selected.assets.length,
    menus: selected.menus.length,
    roles: selected.roles.length,
    credentials: selected.credentials.length,
    redirects: selected.redirects.length,
    plugins: Object.fromEntries(
      known.map(({ kind }) => [
        kind,
        plugins.find((entry) => entry.kind === kind)?.entries.length ?? 0,
      ]),
    ),
    published: selected.ordered.filter((content) => content.status === 'published').length,
    files,
    notes,
  };
}

/** Counts per limit key of what an import writes; unknown types count as nothing. */
function importLimits(
  manablox: Manablox,
  data: SpaceExport,
  rows: {
    contentTypes: NonNullable<SpaceExport['contentTypes']>;
    contents: ExportedContent[];
    assets: ExportedAsset[];
    menus: unknown[];
    roles: unknown[];
    redirects: Array<{ source: string }>;
    plugins: PluginSection[];
    snapshots: Array<{ snapshot: SnapshotDataProvider; data: unknown }>;
  },
): Partial<Record<AnyLimitKey, number>> {
  const kinds = new Map(rows.contentTypes.map((type) => [type.id as string, type.kind]));
  const kindOf = (typeId: string) =>
    kinds.get(typeId) ?? manablox.contentTypes.tryGet(typeId)?.kind;
  const documents = rows.contents.filter((row) => kindOf(row.typeId) === 'content').length;
  const entries = rows.contents.filter((row) => kindOf(row.typeId) === 'data').length;
  const dataTypes = rows.contentTypes.filter((type) => type.kind === 'data').length;
  const limits: Partial<Record<AnyLimitKey, number>> = {
    spaces: 1,
    localesPerSpace: data.space.locales.length,
    contentTypes: rows.contentTypes.length - dataTypes,
    databagTypes: dataTypes,
    documents,
    databagEntries: entries,
    storageBytes: rows.assets.reduce((sum, asset) => sum + asset.size, 0),
    menusPerSpace: rows.menus.length,
    customRolesPerSpace: rows.roles.length,
    redirectsPerSpace: rows.redirects.filter((row) => row.source === 'manual').length,
  };
  const add = (counts: Partial<Record<AnyLimitKey, number>> | undefined) => {
    for (const [key, count] of Object.entries(counts ?? {})) {
      const limit = key as AnyLimitKey;
      limits[limit] = (limits[limit] ?? 0) + (count ?? 0);
    }
  };
  for (const { transfer, entries } of rows.plugins) add(transfer.limits?.(entries));
  for (const { snapshot, data } of rows.snapshots) add(snapshot.limits?.(data));
  return limits;
}

const hasTags = (contents: ExportedContent[], assets: ExportedAsset[]): boolean =>
  [...contents, ...assets].some((carrier) => carrier.tags?.length);

/** Publishes, restores dates and records asset usages of written documents. */
async function finishContents(
  manablox: Manablox,
  tx: TransactionRepositories,
  batch: ExportedContent[],
  actorId: string | null,
): Promise<void> {
  // `published_contents` is a projection, rebuilt by publishing.
  const published = batch.filter((content) => content.status === 'published').map((c) => c.id);
  for (const id of published) await tx.content.publish(id, actorId);
  // Publishing stamps now, so the file's dates are restored afterwards.
  await restoreContentDates(tx, batch);
  // This bulk write bypasses the hooks that keep the usage index.
  const rows = await tx.content.listByIds(batch.map((content) => content.id));
  await recordAssetUsages(manablox, tx, rows, published);
}
