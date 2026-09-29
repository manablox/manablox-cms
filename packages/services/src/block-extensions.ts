import { type PluginBlockInstance, pluginFeatureKey, pluginId } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';

/** A plugin's block data as delivered: `field` on each block, from `ext.<id>`. */
export interface BlockDelivery {
  id: string;
  field: string;
  serialize(value: unknown): unknown;
}

/** Plugins with block data that are on for the space, first of an id only. */
async function blockPlugins(manablox: Manablox, spaceId: string | null) {
  const seen = new Set<string>();
  const out = [];
  for (const plugin of manablox.config.plugins) {
    const id = pluginId(plugin.name);
    if (!plugin.blocks || seen.has(id)) continue;
    seen.add(id);
    if (!(await manablox.controls.feature(spaceId, pluginFeatureKey(plugin))).enabled) continue;
    out.push({ id, blocks: plugin.blocks });
  }
  return out;
}

/** Block data checks of the plugins on for the space, by plugin id. */
export async function blockInstanceChecks(
  manablox: Manablox,
  spaceId: string | null,
): Promise<ReadonlyMap<string, PluginBlockInstance>> {
  const checks = new Map<string, PluginBlockInstance>();
  for (const { id, blocks } of await blockPlugins(manablox, spaceId)) {
    if (blocks.instance) checks.set(id, blocks.instance);
  }
  return checks;
}

/** Delivered block data of the plugins on for the space. */
export async function blockDeliveries(
  manablox: Manablox,
  spaceId: string | null,
): Promise<BlockDelivery[]> {
  return (await blockPlugins(manablox, spaceId)).flatMap(({ id, blocks }) =>
    blocks.publicApi
      ? [{ id, field: blocks.publicApi.field, serialize: blocks.publicApi.serialize }]
      : [],
  );
}

/** Each delivery's value for a block, keys left out where it serializes to nothing. */
export function deliveredBlockData(
  ext: Record<string, unknown> | undefined,
  deliveries: readonly BlockDelivery[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!ext) return out;
  for (const delivery of deliveries) {
    if (!(delivery.id in ext)) continue;
    const value = delivery.serialize(ext[delivery.id]);
    if (value !== undefined && value !== null) out[delivery.field] = value;
  }
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `ext` of every block in a value, by block id. */
function storedExtByBlock(
  value: unknown,
  out = new Map<string, Record<string, unknown>>(),
  depth = 0,
) {
  if (depth > 64) return out;
  if (Array.isArray(value)) {
    for (const entry of value) storedExtByBlock(entry, out, depth + 1);
  } else if (isRecord(value)) {
    if (typeof value.blockId === 'string' && isRecord(value.ext)) out.set(value.blockId, value.ext);
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'ext') storedExtByBlock(entry, out, depth + 1);
    }
  }
  return out;
}

/**
 * `fields` with each block's stored `ext` entries of plugins without a check here (not loaded,
 * or off for the space) put back; the incoming ones of those plugins are ignored.
 */
export function keepStoredBlockData(
  fields: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  checks: ReadonlyMap<string, PluginBlockInstance>,
): Record<string, unknown> {
  const byBlock = storedExtByBlock(stored);
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 64) return value;
    if (Array.isArray(value)) return value.map((entry) => walk(entry, depth + 1));
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = key === 'ext' ? entry : walk(entry, depth + 1);
    }
    if (typeof value.blockId !== 'string') return out;
    const ext: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(isRecord(value.ext) ? value.ext : {})) {
      if (checks.has(id)) ext[id] = entry;
    }
    for (const [id, entry] of Object.entries(byBlock.get(value.blockId) ?? {})) {
      if (!checks.has(id)) ext[id] = entry;
    }
    if (Object.keys(ext).length) out.ext = ext;
    else delete out.ext;
    return out;
  };
  return walk(fields, 0) as Record<string, unknown>;
}
