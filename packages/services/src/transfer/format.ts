/** The space export file format, shared by exporter and importer. */

import type {
  ContentStatus,
  ContentTypeDefinition,
  CredentialKind,
  MenuItemTarget,
  RedirectSource,
} from '@manablox/core';
import { ManabloxError } from '@manablox/core';
import type {
  AssetRow,
  ContentRow,
  ContentVersionRow,
  CredentialRow,
  MenuItemNode,
  MenuRow,
  RedirectRow,
  RoleRow,
  SpaceRow,
} from '@manablox/db';

/** The file format's version; files of any other version are refused. */
export const SPACE_EXPORT_VERSION = 1;

/** Core's optional parts of a transfer; settings always travel. */
export const SPACE_EXPORT_SECTIONS = [
  'contentTypes',
  'contents',
  'history',
  'assets',
  'menus',
  'roles',
  'credentials',
  'redirects',
] as const;

export type CoreExportSection = (typeof SPACE_EXPORT_SECTIONS)[number];

/** A core section or a data provider's kind. */
export type SpaceExportSection = CoreExportSection | (string & Record<never, never>);

/** Whether `section` is one of core's. */
export const isCoreSection = (section: string): section is CoreExportSection =>
  (SPACE_EXPORT_SECTIONS as readonly string[]).includes(section);

/** Sections with per-entry selection; documents are filtered by type, locale and status. */
export const SELECTABLE_SECTIONS = ['contentTypes', 'menus', 'roles', 'credentials'] as const;

export type SelectableSection = (typeof SELECTABLE_SECTIONS)[number];

/** A core section with per-entry selection, or a data provider's kind whose provider lists entries. */
export type PickableSection = SelectableSection | (string & Record<never, never>);

/** Which documents travel. An absent key means "no restriction", never "none". */
export interface ContentSelection {
  typeIds?: readonly string[] | undefined;
  locales?: readonly string[] | undefined;
  statuses?: readonly ContentStatus[] | undefined;
}

/** Sections, entries and a document filter; used for both export and import. */
export interface TransferSelection {
  /** Sections to carry; everything when absent. */
  sections?: readonly SpaceExportSection[] | undefined;
  /**
   * Entries to keep per section: a core one's, or a data provider's that lists its entries;
   * unnamed sections keep all.
   */
  ids?: Partial<Record<PickableSection, readonly string[]>> | undefined;
  /** Narrows `contents` and its history. */
  contents?: ContentSelection | undefined;
}

export interface SpaceExport {
  /** Rejects stray JSON files. */
  manabloxSpaceExport: number;
  exportedAt: string;
  /** The sections this file holds. */
  sections: SpaceExportSection[];
  space: {
    id: string;
    name: string;
    machineName: string;
    description: string | null;
    url: string;
    defaultLocale: string;
    locales: string[];
    settings: Record<string, unknown>;
  };
  /** Runtime-defined types only; code-defined ones come from the target's own config. */
  contentTypes?: ContentTypeDefinition[];
  contents?: ExportedContent[];
  /** Metadata only; the bucket is copied separately. */
  assets?: ExportedAsset[];
  menus?: ExportedMenu[];
  roles?: ExportedRole[];
  /** The vault's entries without their secrets; see `ExportedCredential`. */
  credentials?: ExportedCredential[];
  redirects?: ExportedRedirect[];
  /** Data provider sections by kind. */
  plugins?: Record<string, unknown[]>;
  /** Plugin settings of the exported environment by plugin id, nominations as production's. */
  pluginSettings?: Record<string, Record<string, unknown>>;
  /** Data provider snapshot state by kind; snapshots only. */
  snapshots?: Record<string, unknown>;
}

export interface ExportedRedirect {
  locale: string | null;
  fromPath: string;
  toPath: string | null;
  /** A localization id; ids travel unchanged. */
  toContentId: string | null;
  status: number;
  source: RedirectSource;
}

/** Config-owned rows never travel; the target gets them from its own config. */
export const runtimeOnly = <T extends { source: string }>(rows: T[]): T[] =>
  rows.filter((row) => row.source !== 'code');

export interface ExportedMenu {
  id: string;
  name: string;
  machineName: string;
  description: string | null;
  items: ExportedMenuItem[];
}

export interface ExportedMenuItem {
  id: string;
  localizationId: string | null;
  label: string | null;
  url: string | null;
  target: MenuItemTarget;
  children: ExportedMenuItem[];
}

export interface ExportedContent {
  id: string;
  typeId: string;
  locale: string;
  localizationId: string;
  parentId: string | null;
  title: string;
  slug: string;
  status: string;
  position: number;
  fields: Record<string, unknown>;
  /** Ancestor path, used to import parents first. */
  path: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Publish date and scheduling window. */
  publishedAt: string | null;
  publishAt: string | null;
  unpublishAt: string | null;
  /** Every saved version, oldest first. Only with the `history` section. */
  versions?: ExportedContentVersion[];
  /** Tag names, shared by the localization group; absent without tags. */
  tags?: string[];
}

export interface ExportedContentVersion {
  version: number;
  label: string | null;
  /** The whole row, as rollback restores it. */
  snapshot: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
}

export interface ExportedAsset {
  id: string;
  driver: string;
  key: string;
  filename: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  checksum: string | null;
  alt: string | null;
  title: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Media availability window. */
  publishAt: string | null;
  unpublishAt: string | null;
  /** Tag names this space gives it; absent without tags. */
  tags?: string[];
}

export interface ExportedRole {
  id: string;
  name: string;
  machineName: string;
  description: string | null;
  permissions: string[];
}

/** A vault entry without its secret, which is sealed per instance; the id is kept so references resolve. */
export interface ExportedCredential {
  id: string;
  name: string;
  slug: string;
  kind: CredentialKind;
  provider: string;
}

export interface ImportResult {
  spaceId: string;
  /** The request intersected with what the file holds. */
  sections: SpaceExportSection[];
  contentTypes: number;
  contents: number;
  /** Stored document versions, when the history section was restored. */
  versions: number;
  assets: number;
  menus: number;
  roles: number;
  credentials: number;
  redirects: number;
  /** Entries restored per data provider section. */
  plugins: Record<string, number>;
  published: number;
  /** Asset files stored from the archive. */
  files: number;
  /** What the import changed or created to fit, e.g. why an entry was skipped. */
  notes: string[];
}

/** One entry a section holds, as the transfer dialog lists it. */
export interface TransferEntry {
  id: string;
  label: string;
}

/** A group of documents, with how many are in it. */
export interface TransferCount extends TransferEntry {
  count: number;
}

/** Counts per section for the transfer dialog, without loading every document. */
export interface TransferInventory {
  contentTypes: TransferEntry[];
  contents: {
    total: number;
    types: TransferCount[];
    locales: TransferCount[];
    statuses: TransferCount[];
  };
  assets: number;
  menus: TransferEntry[];
  roles: TransferEntry[];
  credentials: TransferEntry[];
  redirects: number;
  /** Entries per data provider section. */
  plugins: Record<string, number>;
  /** The entries of data provider sections that can be picked one by one, by kind. */
  pluginEntries: Record<string, TransferEntry[]>;
}

/**
 * A data provider's entries a selection keeps: all unless the provider lists its entries and
 * the selection names some; an entry without a string `id` always stays.
 */
export function keepPicked<E>(
  transfer: { entries?: unknown },
  entries: E[],
  ids: readonly string[] | undefined,
): E[] {
  if (!transfer.entries || !ids) return entries;
  const wanted = new Set(ids);
  return entries.filter((entry) => {
    const id = (entry as { id?: unknown } | null)?.id;
    return typeof id !== 'string' || wanted.has(id);
  });
}

/** Keeps the named entries; all when none are named. */
export function keepChosen<T>(
  rows: T[],
  ids: readonly string[] | undefined,
  idOf: (row: T) => string = (row) => (row as { id: string }).id,
): T[] {
  if (!ids) return rows;
  const wanted = new Set(ids);
  return rows.filter((row) => wanted.has(idOf(row)));
}

/** Filters documents, dropping ones that would arrive orphaned. */
export function selectContents(
  contents: ExportedContent[],
  filter: ContentSelection | undefined,
): ExportedContent[] {
  const byType = filter?.typeIds?.length ? new Set(filter.typeIds) : null;
  const byLocale = filter?.locales?.length ? new Set<string>(filter.locales) : null;
  const byStatus = filter?.statuses?.length ? new Set<string>(filter.statuses) : null;
  if (!byType && !byLocale && !byStatus) return contents;
  return pruneOrphans(
    contents.filter(
      (content) =>
        (!byType || byType.has(content.typeId)) &&
        (!byLocale || byLocale.has(content.locale)) &&
        (!byStatus || byStatus.has(content.status)),
    ),
  );
}

/** Drops documents whose parent was filtered out, repeating until stable. */
export function pruneOrphans(contents: ExportedContent[]): ExportedContent[] {
  let kept = contents;
  for (;;) {
    const ids = new Set(kept.map((content) => content.id));
    const next = kept.filter((content) => !content.parentId || ids.has(content.parentId));
    if (next.length === kept.length) return next;
    kept = next;
  }
}

export const byLabel = (a: TransferEntry, b: TransferEntry): number =>
  a.label.localeCompare(b.label);

export const toExportedMenuItem = (node: MenuItemNode): ExportedMenuItem => ({
  id: node.item.id,
  localizationId: node.item.localizationId,
  label: node.item.label,
  url: node.item.url,
  target: node.item.target,
  children: node.children.map(toExportedMenuItem),
});

export const toExportedMenu = (row: MenuRow, tree: MenuItemNode[]): ExportedMenu => ({
  id: row.id,
  name: row.name,
  machineName: row.machineName,
  description: row.description,
  items: tree.map(toExportedMenuItem),
});

/** `a.b.c` is two levels below `a`. */
export const depth = (path: string): number => path.split('.').length;

/** A missing or invalid date falls back to now. */
export function dateOf(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** The same, for an optional date. */
export function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The declared sections the file knows, core sections first. */
function sectionsOf(data: Partial<SpaceExport>): SpaceExportSection[] {
  const declared = new Set<string>(Array.isArray(data.sections) ? data.sections : []);
  return [
    ...SPACE_EXPORT_SECTIONS.filter((section) => declared.has(section)),
    ...Object.keys(data.plugins ?? {}).filter((kind) => declared.has(kind)),
  ];
}

/** Checks that `payload` is an export file of the current version. */
export function assertExport(payload: unknown): SpaceExport {
  const data = payload as Partial<SpaceExport> | null;

  if (!data || typeof data !== 'object' || typeof data.manabloxSpaceExport !== 'number') {
    throw ManabloxError.badRequest('space.import.notAnExport');
  }
  if (data.manabloxSpaceExport !== SPACE_EXPORT_VERSION) {
    throw ManabloxError.badRequest('space.import.versionUnsupported', {
      found: data.manabloxSpaceExport,
      expected: SPACE_EXPORT_VERSION,
    });
  }
  if (!data.space?.id || !data.space.machineName) {
    throw ManabloxError.badRequest('space.import.notAnExport');
  }
  return { ...data, sections: sectionsOf(data) } as SpaceExport;
}

export const toExportedSpace = (space: SpaceRow): SpaceExport['space'] => ({
  id: space.id,
  name: space.name,
  machineName: space.machineName,
  description: space.description,
  url: space.url,
  defaultLocale: space.defaultLocale,
  locales: space.locales,
  settings: space.settings as Record<string, unknown>,
});

export const toExportedContent = (row: ContentRow): ExportedContent => ({
  id: row.id,
  typeId: row.typeId,
  locale: row.locale,
  localizationId: row.localizationId,
  parentId: row.parentId,
  title: row.title,
  slug: row.slug,
  status: row.status,
  position: row.position,
  fields: row.fields as Record<string, unknown>,
  path: row.path,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
  publishAt: row.publishAt?.toISOString() ?? null,
  unpublishAt: row.unpublishAt?.toISOString() ?? null,
});

export const toExportedVersion = (row: ContentVersionRow): ExportedContentVersion => ({
  version: row.version,
  label: row.label,
  snapshot: row.snapshot as Record<string, unknown>,
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
});

export const toExportedAsset = (row: AssetRow): ExportedAsset => ({
  id: row.id,
  driver: row.driver,
  key: row.key,
  filename: row.filename,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  width: row.width,
  height: row.height,
  duration: row.duration,
  checksum: row.checksum,
  alt: row.alt,
  title: row.title,
  meta: row.meta as Record<string, unknown>,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  publishAt: row.publishAt?.toISOString() ?? null,
  unpublishAt: row.unpublishAt?.toISOString() ?? null,
});

export const toExportedRole = (row: RoleRow): ExportedRole => ({
  id: row.id,
  name: row.name,
  machineName: row.machineName,
  description: row.description,
  permissions: row.permissions,
});

export const toExportedCredential = (row: CredentialRow): ExportedCredential => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  kind: row.kind,
  provider: row.provider,
});

export const toExportedRedirect = (row: RedirectRow): ExportedRedirect => ({
  locale: row.locale,
  fromPath: row.fromPath,
  toPath: row.toPath,
  toContentId: row.toContentId,
  status: row.status,
  source: row.source,
});
