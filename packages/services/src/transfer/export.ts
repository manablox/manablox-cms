import type { Scope } from '@manablox/core';
import type { AssetRow, ContentRow, MenuItemNode, RedirectRow, Repositories } from '@manablox/db';
import {
  type ExportedAsset,
  type ExportedContent,
  type ExportedMenu,
  keepChosen,
  toExportedMenu,
  toExportedVersion,
} from './format.js';

export async function attachHistory(
  repos: Repositories,
  contents: ExportedContent[],
): Promise<void> {
  const byId = new Map(contents.map((content) => [content.id, content]));
  for (const content of contents) content.versions ??= [];
  for (const row of await repos.content.listVersions([...byId.keys()])) {
    byId.get(row.contentId)?.versions?.push(toExportedVersion(row));
  }
}

/** Tag names per document, so an import can rebuild the space's vocabulary. */
export async function attachContentTags(
  repos: Repositories,
  contents: ExportedContent[],
): Promise<void> {
  const byGroup = await repos.tags.listByLocalizations([
    ...new Set(contents.map((content) => content.localizationId)),
  ]);
  for (const content of contents) {
    const tags = byGroup.get(content.localizationId);
    if (tags?.length) content.tags = tags.map((tag) => tag.name);
  }
}

export async function attachAssetTags(
  repos: Repositories,
  spaceId: string,
  assets: ExportedAsset[],
): Promise<void> {
  const byAsset = await repos.tags.listByAssets(
    assets.map((asset) => asset.id),
    spaceId,
  );
  for (const asset of assets) {
    const tags = byAsset.get(asset.id);
    if (tags?.length) asset.tags = tags.map((tag) => tag.name);
  }
}

/** Every document of the scope, in the list order, walked by keyset. */
export async function allContent(repos: Repositories, scope: Scope): Promise<ContentRow[]> {
  const filter =
    typeof scope === 'string'
      ? { spaceId: scope }
      : { spaceId: scope.spaceId, environmentId: scope.environmentId };
  return collect(repos.content.batches(filter));
}

export function allAssets(repos: Repositories, spaceId: string): Promise<AssetRow[]> {
  return collect(repos.assets.batches(spaceId));
}

export async function allMenus(
  repos: Repositories,
  scope: Scope,
  ids?: readonly string[],
): Promise<ExportedMenu[]> {
  const rows = keepChosen(await repos.menus.listBySpace(scope), ids);
  // Independent reads, in parallel.
  const trees = await Promise.all(rows.map((row) => repos.menus.listItemTree(row.id)));
  return rows.map((row, index) => toExportedMenu(row, trees[index] as MenuItemNode[]));
}

export function allRedirects(repos: Repositories, scope: Scope): Promise<RedirectRow[]> {
  return collect(repos.redirects.batches(scope));
}

async function collect<T>(batches: AsyncIterable<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for await (const batch of batches) rows.push(...batch);
  return rows;
}
