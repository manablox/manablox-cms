import {
  type BlockValue,
  type ContentTypeDefinition,
  fieldBlocks,
  fieldItems,
  fieldSubFields,
  itemsContentType,
  readTemplateBlocks,
  resolveGraphQL,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { blockGridOf, deliveredBlockData } from '@manablox/services';
import { type AssetVariantSpec, serializeAsset } from './asset.js';
import { asLink, assetFields, type Resolved, toIds } from './collect.js';
import type { PublicContext } from './context.js';
import type {
  ExpandSet,
  PublicBlock,
  PublicBlocks,
  PublicContent,
  PublicItem,
  PublicLink,
  PublicUser,
} from './serialize.js';

// Pass 3 - build

export function buildContent(
  row: ContentRow,
  ctx: PublicContext,
  expand: ExpandSet,
  resolved: Resolved,
): PublicContent {
  const type = ctx.manablox.contentTypes.tryGet(row.typeId);
  return {
    id: row.id,
    type: type?.name ?? 'unknown',
    title: row.title,
    slug: row.slug,
    permalink: row.permalink,
    locale: row.locale,
    parentId: row.parentId,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    fields: type ? buildFields(type, row.fields, ctx, expand, resolved, 0) : {},
    tags: resolved.contentTags.get(row.localizationId) ?? [],
  };
}

function buildFields(
  type: ContentTypeDefinition,
  values: Record<string, unknown>,
  ctx: PublicContext,
  expand: ExpandSet,
  resolved: Resolved,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 16) return out;

  for (const field of type.fields) {
    // Role-gated fields are omitted, matching GraphQL.
    if (field.readRoles?.length) continue;

    const fieldType = ctx.manablox.fieldTypes.tryGet(field.type);
    if (!fieldType) continue;

    const value = values[field.name];
    const spec = resolveGraphQL(fieldType, field.settings);

    if (fieldType.nested) {
      const blocks = buildBlocks(
        fieldBlocks(fieldType, value, field.settings),
        ctx,
        expand,
        resolved,
        depth,
      );
      out[field.name] =
        spec.list === false
          ? (blocks[0] ?? null)
          : ({ grid: blockGridOf(value), blocks } satisfies PublicBlocks);
      continue;
    }

    const subFields = fieldSubFields(fieldType, field.settings);
    if (subFields) {
      const itemType = itemsContentType(type, field, subFields);
      out[field.name] = fieldItems(fieldType, value, field.settings).map(
        (item) =>
          ({
            itemId: item.itemId,
            fields: buildFields(itemType, item.fields, ctx, expand, resolved, depth + 1),
          }) satisfies PublicItem,
      );
      continue;
    }

    // Delivered like a `blocks` field; a missing or unpublished template is empty.
    if (spec.type.kind === 'blockRef') {
      const id = toIds(value)[0] ?? null;
      const template = id ? resolved.content.get(id) : undefined;
      const blocksValue = readTemplateBlocks(ctx.manablox.contentTypes, template ?? null);
      out[field.name] = {
        grid: blockGridOf(blocksValue),
        blocks: buildBlocks(blocksValue?.blocks ?? [], ctx, expand, resolved, depth),
      } satisfies PublicBlocks;
      continue;
    }

    // `href` is null when the internal target is gone or unpublished.
    if (spec.type.kind === 'link') {
      const link = asLink(value);
      if (!link) {
        out[field.name] = null;
        continue;
      }
      const row =
        link.mode === 'internal' && link.contentId
          ? (resolved.content.get(link.contentId) ?? null)
          : null;
      out[field.name] = {
        ...link,
        href: link.mode === 'external' ? link.url : (row?.permalink ?? null),
        ...(expand.has(field.name) && row
          ? { content: inline('content', row.id, ctx, resolved) }
          : {}),
      } satisfies PublicLink;
      continue;
    }

    // A `filter` relation delivers its query's matches.
    if (spec.type.kind === 'ref' && resolved.queries.has(field.id)) {
      const target = spec.type.target;
      const ids = resolved.queries.get(field.id) ?? [];
      out[field.name] = expand.has(field.name)
        ? ids
            .map((id) => inline(target, id, ctx, resolved, field.settings))
            .filter((entry) => entry !== null)
        : ids;
      continue;
    }

    if (spec.type.kind === 'ref' && expand.has(field.name)) {
      const ids = toIds(value);
      const inlined = ids
        .map((id) =>
          inline(
            spec.type.kind === 'ref' ? spec.type.target : 'content',
            id,
            ctx,
            resolved,
            field.settings,
          ),
        )
        .filter((entry) => entry !== null);
      out[field.name] = spec.list ? inlined : (inlined[0] ?? null);
      continue;
    }

    out[field.name] = value ?? null;
  }

  return out;
}

function buildBlocks(
  blocks: BlockValue[],
  ctx: PublicContext,
  expand: ExpandSet,
  resolved: Resolved,
  depth: number,
): PublicBlock[] {
  return blocks.map((block) => {
    const blockType = ctx.manablox.contentTypes.tryGet(block.type);
    return {
      blockId: block.blockId,
      type: blockType?.name ?? 'unknown',
      fields: blockType
        ? buildFields(blockType, block.fields, ctx, expand, resolved, depth + 1)
        : {},
      ...(block.layout ? { layout: block.layout } : {}),
      ...deliveredBlockData(block.ext, resolved.blockData),
    } satisfies PublicBlock;
  });
}

function inline(
  target: 'content' | 'asset' | 'user',
  id: string,
  ctx: PublicContext,
  resolved: Resolved,
  /** Decides the asset's renditions. */
  spec?: AssetVariantSpec,
): unknown {
  if (target === 'asset') {
    const asset = resolved.asset.get(id);
    return asset ? serializeAsset(asset, ctx, spec, resolved.assetTags.get(id) ?? []) : null;
  }
  if (target === 'user') {
    const user = resolved.user.get(id);
    return user ? ({ id: user.id, name: user.name, image: user.image } satisfies PublicUser) : null;
  }

  const row = resolved.content.get(id);
  if (!row) return null;
  const type = ctx.manablox.contentTypes.tryGet(row.typeId);
  // One-level summary; never expands recursively.
  return {
    id: row.id,
    type: type?.name ?? 'unknown',
    title: row.title,
    permalink: row.permalink,
    locale: row.locale,
    tags: resolved.contentTags.get(row.localizationId) ?? [],
    ...(ctx.relatedFields && type
      ? { fields: buildFields(type, row.fields, ctx, assetFields(type), resolved, 1) }
      : {}),
  };
}
