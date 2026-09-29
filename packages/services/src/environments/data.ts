import type { Manablox } from '@manablox/core/node';
import type { EnvironmentRow, EnvironmentTableKind, Repositories } from '@manablox/db';
import type { EnvironmentDataProvider } from '../data/provider.js';
import type { EnvironmentProvider } from '../data/registry.js';

type Rows<K extends EnvironmentTableKind> = EnvironmentRow<K>[];

/** The rows of one environment a copy or promote moves. */
export interface EnvironmentData {
  contentTypes: Rows<'contentTypes'>;
  /** Every document, or templates only. */
  contents: Rows<'contents'>;
  published: Rows<'publishedContents'>;
  versions: Rows<'contentVersions'>;
  menus: Rows<'menus'>;
  menuItems: Rows<'menuItems'>;
  redirects: Rows<'redirects'>;
  contentTags: Rows<'contentTags'>;
  assetUsages: Rows<'assetUsages'>;
  /** Data providers' rows, in provider order. */
  plugins: ProviderRows[];
}

/** One data provider's rows of an environment. */
interface ProviderRows {
  key: string;
  handler: EnvironmentDataProvider;
  rows: Array<{ id: string }>;
}

export interface LoadOptions {
  /** Every document; else templates only. Versions, tags and asset usages follow them. */
  content: boolean;
  /** The global template type, whose documents are config. */
  templateTypeId: string | null;
  /** Redirects without content: every one, or those to a path. */
  redirects?: 'all' | 'paths';
  /** Menu entries; always loaded with content. */
  menuItems?: boolean;
  /** Data providers whose rows load too; content ones only with `content`. */
  providers?: { manablox: Manablox; spaceId: string; list: readonly EnvironmentProvider[] };
}

/** Reads an environment's rows. */
export async function loadEnvironment(
  repos: Repositories,
  environmentId: string,
  options: LoadOptions,
): Promise<EnvironmentData> {
  const rows = repos.environmentRows;
  const templates = options.templateTypeId ? [options.templateTypeId] : [];
  // One query at a time: the caller may hold a transaction's single connection.
  const contentTypes = await rows.list('contentTypes', environmentId);
  const contents = options.content
    ? await rows.list('contents', environmentId)
    : await rows.ofTypes('contents', environmentId, templates);
  const published = options.content
    ? await rows.list('publishedContents', environmentId)
    : await rows.ofTypes('publishedContents', environmentId, templates);
  const menus = await rows.list('menus', environmentId);
  const ids = <T extends { id: string }>(list: T[]) => list.map((row) => row.id);
  const versions = await rows.children('contentVersions', ids(contents));
  const menuItems =
    options.content || options.menuItems ? await rows.children('menuItems', ids(menus)) : [];
  const redirects =
    options.content || options.redirects
      ? (await rows.list('redirects', environmentId)).filter(
          (row) => options.content || options.redirects === 'all' || row.toContentId === null,
        )
      : [];
  // Templates carry their tags and asset usages too: read for them alone, or with every
  // document the environment's whole lists, less rows of no document.
  const documents = new Set(ids(contents));
  const groups = new Set(contents.map((row) => row.localizationId));
  const contentTags = (
    options.content
      ? await rows.list('contentTags', environmentId)
      : await rows.listWhereIn('contentTags', environmentId, 'localizationId', [...groups])
  ).filter((row) => groups.has(row.localizationId));
  const assetUsages = (
    options.content
      ? await rows.list('assetUsages', environmentId)
      : await rows.listWhereIn('assetUsages', environmentId, 'contentId', [...documents])
  ).filter((row) => documents.has(row.contentId));
  const plugins: ProviderRows[] = [];
  if (options.providers) {
    const { manablox, spaceId, list } = options.providers;
    for (const { key, handler } of list) {
      if (handler.content && !options.content) continue;
      const loaded = await handler.load({ manablox, repos, spaceId, environmentId });
      plugins.push({ key, handler, rows: loaded });
    }
  }
  return {
    contentTypes,
    contents,
    published,
    versions,
    menus,
    menuItems,
    redirects,
    contentTags,
    assetUsages,
    plugins,
  };
}

/** Menu entries with every parent before its children. */
export function parentsFirst<T extends { id: string; parentId: string | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: T[] = [];
  const placed = new Set<string>();
  const place = (row: T, seen: Set<string>) => {
    if (placed.has(row.id) || seen.has(row.id)) return;
    seen.add(row.id);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) place(parent, seen);
    placed.add(row.id);
    out.push(row);
  };
  for (const row of rows) place(row, new Set());
  return out;
}
