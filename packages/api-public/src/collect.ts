import {
  type ContentTypeDefinition,
  fieldBlocks,
  fieldItems,
  fieldSubFields,
  isTemplateType,
  itemsContentType,
  type LinkValue,
  resolveGraphQL,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, ContentRow, UserRow } from '@manablox/db';
import { type BlockDelivery, blockDeliveries, isFilterRelation } from '@manablox/services';
import { toPublicTags } from './asset.js';
import type { PublicContext } from './context.js';
import type { ExpandSet, PublicTag } from './serialize.js';

export interface Collected {
  content: Set<string>;
  asset: Set<string>;
  user: Set<string>;
  /** `filter` relations by field id, queried once each. */
  queries: Map<string, { target: 'content' | 'asset'; settings: Record<string, unknown> }>;
}

export interface Resolved {
  content: Map<string, ContentRow>;
  asset: Map<string, AssetRow>;
  user: Map<string, UserRow>;
  /** Matched ids per `filter` relation, in delivery order. */
  queries: Map<string, string[]>;
  /** Tags by localization group, for every document built here. */
  contentTags: Map<string, PublicTag[]>;
  /** Tags by asset id, for every asset inlined here. */
  assetTags: Map<string, PublicTag[]>;
  /** Plugin block data delivered in this space. */
  blockData: BlockDelivery[];
}

/** Loads collected ids, then what loaded templates reference; three rounds bound cycles. */
export async function resolveInRounds(
  collected: Collected,
  ctx: PublicContext,
  expand: ExpandSet,
): Promise<Resolved> {
  const resolved: Resolved = {
    content: new Map(),
    asset: new Map(),
    user: new Map(),
    queries: new Map(),
    contentTags: new Map(),
    assetTags: new Map(),
    blockData: await blockDeliveries(ctx.manablox, ctx.spaceId),
  };
  const walked = new Set<string>();

  await runRelationQueries(collected, resolved, ctx);

  for (let round = 0; round < 3; round += 1) {
    const pending: Collected = {
      content: missing(collected.content, resolved.content),
      asset: missing(collected.asset, resolved.asset),
      user: missing(collected.user, resolved.user),
      queries: new Map(),
    };
    if (!pending.content.size && !pending.asset.size && !pending.user.size) break;

    const loaded = await resolveAll(pending, ctx);
    for (const [id, row] of loaded.content) resolved.content.set(id, row);
    for (const [id, row] of loaded.asset) resolved.asset.set(id, row);
    for (const [id, row] of loaded.user) resolved.user.set(id, row);

    // Only templates are walked further; expanded relations stay one level deep.
    for (const [id, row] of loaded.content) {
      const type = ctx.manablox.contentTypes.tryGet(row.typeId);
      if (!type || walked.has(id)) continue;
      if (isTemplateType(type)) {
        walked.add(id);
        collectFields(type, row.fields, ctx.manablox, expand, collected, 0);
      } else if (ctx.relatedFields) {
        // Only the assets of a related document, which delivery inlines with its fields.
        walked.add(id);
        const own: Collected = {
          content: new Set(),
          asset: new Set(),
          user: new Set(),
          queries: new Map(),
        };
        collectFields(type, row.fields, ctx.manablox, assetFields(type), own, 0);
        for (const asset of own.asset) collected.asset.add(asset);
      }
    }
  }

  return resolved;
}

/** Expands only a type's own asset fields. */
export function assetFields(type: ContentTypeDefinition): ExpandSet {
  return new Set(type.fields.filter((field) => field.type === 'asset').map((field) => field.name));
}

/** Runs each `filter` relation's query once. User relations never filter. */
async function runRelationQueries(
  collected: Collected,
  resolved: Resolved,
  ctx: PublicContext,
): Promise<void> {
  await Promise.all(
    [...collected.queries].map(async ([fieldId, { target, settings }]) => {
      const result = await ctx.reader.relation(fieldId, target, settings);
      const rows: Map<string, AssetRow | ContentRow> =
        result.target === 'asset' ? resolved.asset : resolved.content;
      for (const row of result.items) rows.set(row.id, row);
      resolved.queries.set(
        fieldId,
        result.items.map((row) => row.id),
      );
    }),
  );
}

function missing(wanted: Set<string>, have: Map<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const id of wanted) if (!have.has(id)) out.add(id);
  return out;
}

/** Tags for every document and asset the page will build, in two queries. */
export async function loadTags(
  rows: ContentRow[],
  ctx: PublicContext,
  resolved: Resolved,
): Promise<void> {
  const localizationIds = new Set<string>();
  for (const row of [...rows, ...resolved.content.values()]) {
    localizationIds.add(row.localizationId);
  }
  const assetIds = [...resolved.asset.keys()];
  const [byGroup, byAsset] = await Promise.all([
    localizationIds.size > 0 ? ctx.repos.tags.listByLocalizations([...localizationIds]) : new Map(),
    assetIds.length > 0 ? ctx.repos.tags.listByAssets(assetIds, ctx.spaceId) : new Map(),
  ]);
  for (const [key, tags] of byGroup) resolved.contentTags.set(key, toPublicTags(tags));
  for (const [key, tags] of byAsset) resolved.assetTags.set(key, toPublicTags(tags));
}

// Pass 1 - collect

export function collectRow(
  row: ContentRow,
  manablox: Manablox,
  expand: ExpandSet,
  into: Collected,
): void {
  const type = manablox.contentTypes.tryGet(row.typeId);
  if (!type) return;
  collectFields(type, row.fields, manablox, expand, into, 0);
}

function collectFields(
  type: ContentTypeDefinition,
  values: Record<string, unknown>,
  manablox: Manablox,
  expand: ExpandSet,
  into: Collected,
  depth: number,
): void {
  if (depth > 16) return;

  for (const field of type.fields) {
    if (field.readRoles?.length) continue;
    const fieldType = manablox.fieldTypes.tryGet(field.type);
    if (!fieldType) continue;

    const value = values[field.name];
    const spec = resolveGraphQL(fieldType, field.settings);

    if (spec.type.kind === 'ref') {
      if (spec.type.target !== 'user' && isFilterRelation(field.settings)) {
        into.queries.set(field.id, { target: spec.type.target, settings: field.settings });
      } else if (expand.has(field.name)) {
        for (const id of toIds(value)) into[spec.type.target].add(id);
      }
    }

    // Internal links always need the row for their permalink.
    if (spec.type.kind === 'link') {
      const link = asLink(value);
      if (link?.mode === 'internal' && link.contentId) into.content.add(link.contentId);
    }

    // Template blocks replace the reference, so the row is always needed.
    if (spec.type.kind === 'blockRef') {
      for (const id of toIds(value)) into.content.add(id);
    }

    if (fieldType.nested) {
      for (const block of fieldBlocks(fieldType, value, field.settings)) {
        const blockType = manablox.contentTypes.tryGet(block.type);
        if (blockType) {
          collectFields(blockType, block.fields, manablox, expand, into, depth + 1);
        }
      }
    }

    const subFields = fieldSubFields(fieldType, field.settings);
    if (subFields) {
      const itemType = itemsContentType(type, field, subFields);
      for (const item of fieldItems(fieldType, value, field.settings)) {
        collectFields(itemType, item.fields, manablox, expand, into, depth + 1);
      }
    }
  }
}

// Pass 2 - load

async function resolveAll(
  collected: Collected,
  ctx: PublicContext,
): Promise<Pick<Resolved, 'content' | 'asset' | 'user'>> {
  const [contents, assets, users] = await Promise.all([
    ctx.reader.byIds(collected.content),
    ctx.reader.assets(collected.asset),
    loadMany(ctx.loaders.user, collected.user),
  ]);

  return { content: contents, asset: assets, user: users };
}

async function loadMany<T extends { id: string }>(
  loader: { loadMany: (ids: string[]) => Promise<Array<T | null | Error>> },
  ids: Set<string>,
): Promise<Map<string, T>> {
  if (ids.size === 0) return new Map();
  const rows = await loader.loadMany([...ids]);
  const map = new Map<string, T>();
  for (const row of rows) {
    if (row && !(row instanceof Error)) map.set(row.id, row);
  }
  return map;
}

/** Reads a stored link leniently; anything malformed is `null`. */
export function asLink(value: unknown): LinkValue | null {
  if (!value || typeof value !== 'object') return null;
  const link = value as Partial<LinkValue>;
  if (link.mode !== 'internal' && link.mode !== 'external') return null;
  return {
    mode: link.mode,
    contentId: typeof link.contentId === 'string' ? link.contentId : null,
    url: typeof link.url === 'string' ? link.url : null,
    target: link.target === '_blank' ? '_blank' : '_self',
    label: typeof link.label === 'string' ? link.label : null,
  };
}

export function toIds(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}
