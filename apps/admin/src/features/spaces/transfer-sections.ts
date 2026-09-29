import type { AdminTransferSection } from '@manablox/admin-plugin';
import type { api } from '@manablox/admin-sdk/lib/api';
import { pluginTransferSections } from '~/lib/plugins/registry';

/** What a space offers a transfer, per the server. */
export type TransferInventory = Awaited<ReturnType<typeof api.spaces.inventory>>;

/** The document filter as the RPC types it. */
export type TransferContents = NonNullable<
  NonNullable<Parameters<typeof api.spaces.export>[0]['selection']>['contents']
>;

/** One part of the JSON export. */
export type ExportSection = NonNullable<
  NonNullable<Parameters<typeof api.spaces.export>[0]['selection']>['sections']
>[number];

/** Whether a section's entries can be picked one by one. */
export function isPickable(section: TransferSection): boolean {
  return transferSections().some((meta) => meta.kind === section && meta.pickable);
}

export interface TransferEntry {
  id: string;
  label: string;
}

/** What a transfer carries. An absent `ids` key means the whole section; an empty array means none. */
export interface TransferSelection {
  sections: TransferSection[];
  /** By core section or plugin kind. */
  ids: Partial<Record<string, string[]>>;
  contents: { typeIds?: string[]; locales?: string[]; statuses?: string[] };
}

/** A JSON export section, or `files`, which only the archive endpoint carries. */
export type TransferSection = ExportSection | 'files';

/** How the picker groups sections: the admin's groups or a plugin's. */
export type TransferGroup = string;

/** A section of the picker, core's or a plugin's, with its group's id. */
export type TransferSectionMeta = AdminTransferSection & { group: TransferGroup };

interface TransferGroupMeta {
  id: TransferGroup;
  label: string;
  hint: string;
  order: number;
}

const CORE_GROUPS: TransferGroupMeta[] = [
  { id: 'content', label: 'Content', hint: 'What the space holds', order: 100 },
  { id: 'structure', label: 'Model and structure', hint: 'How that content is shaped', order: 200 },
  { id: 'integrations', label: 'Integrations', hint: 'What the space talks to', order: 400 },
];

/** The picker's groups in order, plugin groups among them. */
export function transferGroups(): TransferGroupMeta[] {
  const groups = [...CORE_GROUPS];
  for (const { group } of pluginTransferSections()) {
    if (typeof group === 'string' || groups.some((other) => other.id === group.id)) continue;
    groups.push({ ...group, order: group.order ?? 500 });
  }
  return groups.sort((a, b) => a.order - b.order);
}

/** Transferable sections in server write order, data providers' last. Space settings always travel. */
export function transferSections(): TransferSectionMeta[] {
  return [
    ...CORE_SECTIONS,
    ...pluginTransferSections().map((section) => ({
      ...section,
      group: typeof section.group === 'string' ? section.group : section.group.id,
    })),
  ];
}

const CORE_SECTIONS: TransferSectionMeta[] = [
  {
    kind: 'contentTypes',
    group: 'structure',
    icon: 'blocks',
    label: 'Content types',
    description: "The types built in the admin. Code-defined types come from the target's config.",
    noun: ['content type', 'content types'],
    pickable: true,
  },
  {
    kind: 'contents',
    group: 'content',
    icon: 'doc',
    label: 'Documents',
    description: 'Every document in every locale, drafts and published alike.',
    noun: ['document', 'documents'],
  },
  {
    kind: 'history',
    group: 'content',
    icon: 'clock',
    label: 'Document history',
    description:
      'Every saved version of every document, for rolling back. Makes the file much larger.',
    noun: ['stored version', 'stored versions'],
    requires: 'contents',
  },
  {
    kind: 'assets',
    group: 'content',
    icon: 'image',
    label: 'Asset records',
    description: 'Names, alt texts and metadata.',
    noun: ['asset record', 'asset records'],
  },
  {
    kind: 'files',
    group: 'content',
    icon: 'upload',
    label: 'Asset files',
    description:
      'The files themselves, from the storage bucket. Makes the export a zip archive rather than a JSON file.',
    noun: ['asset file', 'asset files'],
    requires: 'assets',
  },
  {
    kind: 'menus',
    group: 'structure',
    icon: 'list',
    label: 'Menus',
    description: 'Navigation menus and their entries.',
    noun: ['menu', 'menus'],
    pickable: true,
  },
  {
    kind: 'roles',
    group: 'structure',
    icon: 'shield',
    label: 'Roles',
    description: 'Custom roles and their permissions. Members are not carried over.',
    noun: ['role', 'roles'],
    pickable: true,
  },
  {
    kind: 'redirects',
    group: 'structure',
    icon: 'external',
    label: 'Redirects',
    description: 'Manual and automatic redirects of old addresses.',
    noun: ['redirect', 'redirects'],
  },
  {
    kind: 'credentials',
    group: 'integrations',
    icon: 'key',
    label: 'Credentials',
    description:
      "The vault's entries without their secrets, so the nodes and endpoints that name them still resolve.",
    noun: ['credential', 'credentials'],
    pickable: true,
  },
];

/** Loose enough to read counts from any JSON file. */
interface AnyExport {
  sections?: unknown;
  contents?: Array<{ versions?: unknown[] }>;
  /** Present when the file is an archive's manifest. */
  archive?: { files?: unknown };
  [key: string]: unknown;
}

/** A section's rows: a core section's at the top level, a data provider's under `plugins`. */
function rowsOf(data: AnyExport, id: string): unknown {
  return data[id] ?? (data.plugins as Record<string, unknown> | undefined)?.[id];
}

/** Sections in a parsed export file, with entry counts. */
export function sectionsIn(payload: unknown): Map<TransferSection, number> {
  const data = (payload ?? {}) as AnyExport;
  const declared = new Set(Array.isArray(data.sections) ? (data.sections as unknown[]) : []);
  const held = new Map<TransferSection, number>();
  for (const { kind: id } of transferSections()) {
    if (id === 'files') {
      const count = data.archive?.files;
      if (typeof count === 'number' && count > 0) held.set('files', count);
      continue;
    }
    if (id === 'history') {
      const versions = (data.contents ?? []).reduce(
        (sum, content) => sum + (Array.isArray(content.versions) ? content.versions.length : 0),
        0,
      );
      if (declared.has('history')) held.set('history', versions);
      continue;
    }
    if (!declared.has(id)) continue;
    const rows = rowsOf(data, id);
    held.set(id, Array.isArray(rows) ? rows.length : 0);
  }
  return held;
}

/** Drops `files`, which the RPC does not know. */
function exportSections(sections: Iterable<TransferSection>): ExportSection[] {
  return [...sections].filter((section): section is ExportSection => section !== 'files');
}

/** Applies the `requires` links. */
export function withDependencies(selected: Set<TransferSection>): Set<TransferSection> {
  const out = new Set(selected);
  for (const section of transferSections()) {
    if (section.requires && !out.has(section.requires)) out.delete(section.kind);
  }
  return out;
}

/** "3 documents, 1 menu", in section order. */
export function describeCounts(counts: Partial<Record<TransferSection, number>>): string {
  const parts = transferSections().flatMap(({ kind, noun }) => {
    const count = counts[kind];
    if (count === undefined || !noun) return [];
    return [`${count} ${noun[count === 1 ? 0 : 1]}`];
  });
  return parts.join(', ');
}

/** A selection's `ids` and `contents` in RPC shape. */
export function transferPayload(selection: TransferSelection): {
  sections: ExportSection[];
  ids?: Record<string, string[]>;
  contents?: TransferContents;
} {
  const ids = Object.fromEntries(
    Object.entries(selection.ids).filter(
      (entry): entry is [string, string[]] => entry[1] !== undefined,
    ),
  );
  // Statuses come from the inventory, so they are the ones the RPC knows.
  const contents = Object.fromEntries(
    Object.entries(selection.contents).filter(([, picked]) => picked?.length),
  ) as TransferContents;
  return {
    sections: exportSections(selection.sections),
    ...(Object.keys(ids).length ? { ids } : {}),
    ...(Object.keys(contents).length ? { contents } : {}),
  };
}

/** Everything ticked except opt-in sections, nothing narrowed. */
export function everything(sections: TransferSection[]): TransferSelection {
  const optIn = new Set(
    transferSections()
      .filter((s) => s.optIn)
      .map((s) => s.kind),
  );
  return { sections: sections.filter((section) => !optIn.has(section)), ids: {}, contents: {} };
}

/** Loose enough to read entries from any export file. */
interface AnyEntry {
  id?: unknown;
  name?: unknown;
  label?: unknown;
  kind?: unknown;
  typeId?: unknown;
  locale?: unknown;
  status?: unknown;
}

/** Builds the server's export inventory from a file, for the import picker. */
export function inventoryFrom(payload: unknown): TransferInventory {
  const data = (payload ?? {}) as Record<string, AnyEntry[] | undefined>;
  const entries = (section: 'contentTypes' | 'menus' | 'roles' | 'credentials'): TransferEntry[] =>
    (data[section] ?? []).map((entry, index) => ({
      id: typeof entry.id === 'string' ? entry.id : String(index),
      label: labelOf(entry) || `Entry ${index + 1}`,
    }));
  const contents = data.contents ?? [];
  const typeLabels = new Map(
    (data.contentTypes ?? []).map((type) => [type.id as string, labelOf(type)]),
  );
  const group = (key: 'typeId' | 'locale' | 'status', label: (id: string) => string) => {
    const counts = new Map<string, number>();
    for (const row of contents) {
      const id = row[key];
      if (typeof id !== 'string') continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts]
      .map(([id, count]) => ({ id, label: label(id), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  const inventory: TransferInventory = {
    contentTypes: entries('contentTypes'),
    contents: {
      total: contents.length,
      types: group('typeId', (id) => typeLabels.get(id) || id),
      locales: group('locale', (id) => id),
      statuses: group('status', (id) => id),
    },
    assets: (data.assets ?? []).length,
    menus: entries('menus'),
    roles: entries('roles'),
    credentials: entries('credentials'),
    redirects: (data.redirects ?? []).length,
    plugins: {},
    pluginEntries: {},
  };
  // Data provider sections: every entry of `plugins`.
  const plugins = (data.plugins ?? {}) as Record<string, unknown>;
  for (const kind of Object.keys(plugins)) {
    const rows = plugins[kind];
    if (!Array.isArray(rows)) continue;
    inventory.plugins[kind] = rows.length;
    // Picked by `id`, like the server does; rows without one always travel.
    if (isPickable(kind)) {
      inventory.pluginEntries[kind] = (rows as AnyEntry[]).flatMap((entry, index) =>
        typeof entry.id === 'string'
          ? [{ id: entry.id, label: labelOf(entry) || `Entry ${index + 1}` }]
          : [],
      );
    }
  }
  return inventory;
}

/** A row's display name, from whichever column its section uses. */
function labelOf(entry: AnyEntry): string {
  for (const value of [entry.label, entry.name, entry.kind]) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}
