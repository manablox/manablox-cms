import { contentTypeId, type EnvironmentCreateMode } from '@manablox/core';
import type { EnvironmentRow, EnvironmentTableKind } from '@manablox/db';
import type { EnvironmentDataProvider } from '../data/provider.js';
import { movedRow, ownIds } from './copy.js';
import { type EnvironmentData, parentsFirst } from './data.js';
import { copyId, IdMap } from './ids.js';

type Row<K extends EnvironmentTableKind> = EnvironmentRow<K>;

/** What a promote carries: config only, or config and content. */
export type PromoteMode = EnvironmentCreateMode;

export interface PromotePlanInput {
  mode: PromoteMode;
  spaceId: string;
  stagingId: string;
  productionId: string;
  /** Environment ids from production's copy down to the staging one; `null` without a line. */
  lineage: string[] | null;
  staging: EnvironmentData;
  production: EnvironmentData;
  /** Content type ids in use anywhere, so a new id never collides. */
  takenTypeIds: Set<string>;
}

/** Production rows a promote writes and removes; staging rows already under production ids. */
export interface PromotePlan {
  mode: PromoteMode;
  map: IdMap;
  types: { upsert: Row<'contentTypes'>[]; unmatched: Row<'contentTypes'>[] };
  documents: {
    contents: Row<'contents'>[];
    published: Row<'publishedContents'>[];
    versions: Row<'contentVersions'>[];
    contentTags: Row<'contentTags'>[];
    assetUsages: Row<'assetUsages'>[];
  };
  /** `items` replace production's entries in a full promote; a config one keeps them. */
  menus: { upsert: Row<'menus'>[]; items: Row<'menuItems'>[]; remove: Row<'menus'>[] };
  /** A config promote replaces redirects to a path; a full one every redirect. */
  redirects: { upsert: Row<'redirects'>[]; remove: Row<'redirects'>[] };
  /** Data providers' rows, in provider order. */
  plugins: ProviderPlan[];
}

/** One data provider's part of a promote. */
export interface ProviderPlan {
  key: string;
  handler: EnvironmentDataProvider;
  upsert: Array<{ id: string }>;
  remove: Array<{ id: string }>;
  production: Array<{ id: string }>;
}

/** Staging ids mapped to production ids: copied rows to their source, others by natural key. */
export function promoteIds(input: PromotePlanInput): IdMap {
  const { staging, production, spaceId, stagingId, productionId, lineage } = input;
  const map = new IdMap();
  const claimed = new Set<string>();
  const claim = (from: string, to: string) => {
    if (map.has(from) || claimed.has(to)) return;
    map.set(from, to);
    claimed.add(to);
  };

  // Rows copied down the line from production.
  if (lineage) {
    const own = new Set(ownIds(staging));
    for (const id of new Set(ownIds(production))) {
      const copied = lineage.reduce((current, environment) => copyId(environment, current), id);
      if (own.has(copied)) claim(copied, id);
    }
    if (lineage.length === 1) {
      const types = new Set(staging.contentTypes.map((type) => type.id));
      for (const type of production.contentTypes) {
        const copied = contentTypeId(spaceId, type.name, stagingId);
        if (types.has(copied)) claim(copied, type.id);
      }
    }
  }

  // Natural keys for the rest.
  const byKey = <S extends { id: string }, P extends { id: string }>(
    rows: S[],
    targets: P[],
    key: (row: S | P) => string | null,
  ) => {
    const index = new Map<string, string>();
    for (const target of targets) {
      const value = key(target);
      if (value !== null && !claimed.has(target.id)) index.set(value, target.id);
    }
    for (const row of rows) {
      const value = key(row);
      const target = value === null ? undefined : index.get(value);
      if (target) claim(row.id, target);
    }
  };
  byKey(staging.contentTypes, production.contentTypes, (row) => row.name);
  byKey(staging.menus, production.menus, (row) => row.machineName);
  byKey(staging.redirects, production.redirects, (row) => `${row.locale ?? ''}\n${row.fromPath}`);
  for (const entry of staging.plugins) {
    const match = entry.handler.match?.bind(entry.handler);
    const live = production.plugins.find((other) => other.key === entry.key);
    if (match && live) byKey(entry.rows, live.rows, (row) => match(row, map));
  }

  // New rows get fresh production ids.
  for (const type of staging.contentTypes) {
    if (map.has(type.id)) continue;
    const id = contentTypeId(spaceId, type.name);
    claim(type.id, input.takenTypeIds.has(id) ? copyId(productionId, type.id) : id);
  }
  for (const id of ownIds(staging)) {
    if (!map.has(id)) claim(id, copyId(productionId, id));
  }
  return map;
}

/** The production rows a promote writes, from staging under production ids. */
export function planPromote(input: PromotePlanInput, map: IdMap): PromotePlan {
  const { staging, production, productionId, mode } = input;
  const env = { environmentId: productionId };
  const moved = <T extends object>(row: T): T => ({ ...map.remap(row), ...env });
  const unmoved = <T extends object>(row: T): T => map.remap(row);

  const types = staging.contentTypes.map(moved);
  const typeIds = new Set(types.map((type) => type.id));

  const document = <T extends { path: string }>(row: T): T => ({
    ...moved(row),
    path: map.path(row.path),
  });
  const contents = staging.contents.map(document);
  const groups = new Set(contents.map((row) => row.localizationId));
  const known = (group: string | null) => !group || groups.has(group);

  // A full promote only; entries of a missing document go with their sub-entries.
  const kept = new Set<string>();
  const entries = mode === 'full' ? staging.menuItems.map(unmoved) : [];
  const items = parentsFirst(entries).filter((item) => {
    if (item.parentId && !kept.has(item.parentId)) return false;
    if (!known(item.localizationId)) return false;
    kept.add(item.id);
    return true;
  });

  // A config promote moves redirects to a path; those to a document stay unless replaced.
  const redirects = staging.redirects
    .map(moved)
    .filter((row) => (mode === 'full' ? known(row.toContentId) : row.toContentId === null));
  const redirectKey = (row: { locale: string | null; fromPath: string }) =>
    `${row.locale ?? ''}\n${row.fromPath}`;
  const stagedKeys = new Set(redirects.map(redirectKey));
  const removedRedirects = production.redirects.filter(
    (row) => mode === 'full' || row.toContentId === null || stagedKeys.has(redirectKey(row)),
  );

  const menus = staging.menus.map(moved);
  const menuIds = new Set(menus.map((menu) => menu.id));
  // A provider without `promote` only maps ids.
  const plugins = staging.plugins.flatMap((entry): ProviderPlan[] => {
    if (!entry.handler.promote) return [];
    const live = production.plugins.find((other) => other.key === entry.key)?.rows ?? [];
    const promotes = entry.handler.promotes?.bind(entry.handler);
    const upsert = entry.rows
      .filter((row) => promotes?.(row) ?? true)
      .map((row) => movedRow(row, map, productionId));
    const staged = new Set(upsert.map((row) => row.id));
    const keep = entry.handler.keep?.bind(entry.handler);
    return [
      {
        key: entry.key,
        handler: entry.handler,
        upsert,
        remove: live.filter((row) => !staged.has(row.id) && !keep?.(row)),
        production: live,
      },
    ];
  });

  return {
    mode,
    map,
    types: {
      upsert: types,
      unmatched: production.contentTypes.filter((type) => !typeIds.has(type.id)),
    },
    documents: {
      contents,
      published: staging.published.map(document),
      versions: staging.versions.map(unmoved),
      contentTags: staging.contentTags.map(moved),
      assetUsages: staging.assetUsages.map(moved),
    },
    menus: {
      upsert: menus,
      items,
      remove: production.menus.filter((menu) => !menuIds.has(menu.id)),
    },
    redirects: { upsert: redirects, remove: removedRedirects },
    plugins,
  };
}
