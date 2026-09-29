import { randomUUID } from 'node:crypto';
import type { ExportedMenuItem, SpaceExport } from '../transfer/format.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The ids of the records an export creates; assets are shared rows and keep theirs. */
function ownIds(data: SpaceExport, extra: readonly string[]): Set<string> {
  const ids = new Set<string>([data.space.id]);
  for (const id of extra) ids.add(id.toLowerCase());
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id.toLowerCase());
  };
  for (const type of data.contentTypes ?? []) add(type.id as string);
  for (const content of data.contents ?? []) {
    add(content.id);
    add(content.localizationId);
  }
  const addItems = (items: ExportedMenuItem[]) => {
    for (const item of items) {
      add(item.id);
      addItems(item.children);
    }
  };
  for (const menu of data.menus ?? []) {
    add(menu.id);
    addItems(menu.items);
  }
  for (const rows of [data.roles, data.credentials]) {
    for (const row of rows ?? []) add(row.id);
  }
  return ids;
}

/**
 * The export under fresh ids and a new machine name, so it imports beside the space it came
 * from. Every reference to a remapped id moves with it; asset storage keys stay. `pluginIds`
 * are the ids data provider entries keep. `ids` maps each old id to its new one.
 */
export function remapExportIds(
  data: SpaceExport,
  space: { machineName: string; name?: string | undefined },
  pluginIds: readonly string[] = [],
): { data: SpaceExport; ids: Map<string, string> } {
  const own = ownIds(data, pluginIds);
  const fresh = new Map<string, string>();
  const text = JSON.stringify(data).replace(UUID, (id) => {
    const key = id.toLowerCase();
    if (!own.has(key)) return id;
    let mapped = fresh.get(key);
    if (!mapped) {
      mapped = randomUUID();
      fresh.set(key, mapped);
    }
    return mapped;
  });
  const copy = JSON.parse(text) as SpaceExport;
  copy.space.machineName = space.machineName;
  if (space.name) copy.space.name = space.name;
  // Keys name the original space's folder; restored rows must find the kept files.
  if (data.assets) {
    copy.assets = data.assets.map((asset, index) => ({
      ...(copy.assets?.[index] ?? asset),
      driver: asset.driver,
      key: asset.key,
    }));
  }
  return { data: copy, ids: fresh };
}
