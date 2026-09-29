import { contentTypeId, type EnvironmentCreateMode } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceEnvironmentRow } from '@manablox/db';
import { type EnvironmentData, parentsFirst } from './data.js';
import { copyId, IdMap } from './ids.js';

/** Rows a copy wrote, by kind; data providers' by their key. */
export interface EnvironmentCopyCounts extends Record<string, number> {
  contentTypes: number;
  contents: number;
  menus: number;
  menuItems: number;
  redirects: number;
}

/** Where a copy goes. */
export interface CopyTarget {
  manablox: Manablox;
  spaceId: string;
  from: SpaceEnvironmentRow;
  to: SpaceEnvironmentRow;
  mode: EnvironmentCreateMode;
}

/** A data provider's row under the map's ids, in the environment `environmentId`. */
export function movedRow<T extends object>(row: T, map: IdMap, environmentId: string): T {
  const moved = map.remap(row);
  return 'environmentId' in moved ? { ...moved, environmentId } : moved;
}

/** Every id of `data` a copy gives a new id, content types excepted. */
export function ownIds(data: EnvironmentData): string[] {
  const out: string[] = [];
  for (const row of data.contents) out.push(row.id, row.localizationId);
  for (const row of data.published) out.push(row.id, row.localizationId);
  for (const rows of [
    data.versions,
    data.menus,
    data.menuItems,
    data.redirects,
    ...data.plugins.map((entry) => entry.rows),
  ]) {
    for (const row of rows) out.push(row.id);
  }
  return out;
}

/** The ids rows of `data` take in the environment `targetId` of `spaceId`. */
export function copyIds(data: EnvironmentData, spaceId: string, targetId: string): IdMap {
  const map = new IdMap();
  for (const type of data.contentTypes) {
    map.set(type.id, contentTypeId(spaceId, type.name, targetId));
  }
  for (const id of ownIds(data)) map.set(id, copyId(targetId, id));
  return map;
}

/**
 * Writes `data` into the target environment under the ids of `map`; a document whose parent
 * was not copied becomes a root.
 */
export async function writeCopy(
  repos: Repositories,
  data: EnvironmentData,
  map: IdMap,
  target: CopyTarget,
): Promise<EnvironmentCopyCounts> {
  const targetId = target.to.id;
  const rows = repos.environmentRows;
  const env = { environmentId: targetId };

  await rows.insert(
    'contentTypes',
    data.contentTypes.map((row) => ({ ...map.remap(row), ...env })),
  );

  const document = <T extends { id: string; parentId: string | null; path: string }>(row: T): T => {
    const moved = { ...map.remap(row), ...env };
    if (row.parentId && !map.has(row.parentId)) {
      return { ...moved, parentId: null, path: map.id(row.id).replaceAll('-', '_') };
    }
    return { ...moved, path: map.path(row.path) };
  };
  await rows.insert('contents', data.contents.map(document));
  await rows.insert('publishedContents', data.published.map(document));
  await rows.insert(
    'contentVersions',
    data.versions.map((row) => map.remap(row)),
  );

  await rows.insert(
    'menus',
    data.menus.map((row) => ({ ...map.remap(row), ...env })),
  );
  await rows.insert(
    'menuItems',
    parentsFirst(data.menuItems).map((row) => map.remap(row)),
  );

  await rows.insert(
    'redirects',
    data.redirects.map((row) => ({ ...map.remap(row), ...env })),
  );
  await rows.insert(
    'contentTags',
    data.contentTags.map((row) => ({ ...map.remap(row), ...env })),
  );
  await rows.insert(
    'assetUsages',
    data.assetUsages.map((row) => ({ ...map.remap(row), ...env })),
  );

  const counts: EnvironmentCopyCounts = {
    contentTypes: data.contentTypes.length,
    contents: data.contents.length,
    menus: data.menus.length,
    menuItems: data.menuItems.length,
    redirects: data.redirects.length,
  };
  for (const { key, handler, rows: own } of data.plugins) {
    await handler.copy({
      ...target,
      repos,
      rows: own.map((row) => movedRow(row, map, targetId)),
      ids: map,
    });
    counts[key] = own.length;
  }
  return counts;
}
