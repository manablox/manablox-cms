import {
  type ContentTypeDefinition,
  fieldBlocks,
  fieldItems,
  itemsContentType,
  readTemplateBlocks,
  resolveGraphQL,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, ContentRow, UserRow } from '@manablox/db';
import { blockGridOf, isFilterRelation } from '@manablox/services';
import type { BlockListShape, BlockShape, InterfaceRefOf, ObjectRefOf } from './builder.js';
import { camelCase } from './builder.js';
import type { GraphQLContext } from './context.js';
import { resolveReference, resolveRelationQuery } from './relations.js';
import type { ItemType } from './types/items.js';

/** A content type's fields as Pothos field definitions. */
export type FieldMapper = (
  // biome-ignore lint/suspicious/noExplicitAny: Pothos' field builder is generic over a shape only known at runtime
  t: any,
  type: ContentTypeDefinition,
  pick: (parent: never) => Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: the returned field map is equally shape-dependent
) => any;

/** A field's parent: a document, or a block or item it holds, with the document's locale. */
const localeOf = (parent: never) => (parent as { locale?: string }).locale;

/** Hands `parent`'s locale to the values nested in it, for the `filter` relations inside. */
function withLocale<T extends object>(values: T[], parent: never): T[] {
  const locale = localeOf(parent);
  return locale === undefined ? values : values.map((value) => ({ ...value, locale }));
}

/** The refs field values resolve to. */
export interface FieldRefs {
  assetRef: ObjectRefOf<AssetRow>;
  userRef: ObjectRefOf<UserRow>;
  contentInterface: InterfaceRefOf<ContentRow>;
  // biome-ignore lint/suspicious/noExplicitAny: `LinkValue` refs are opaque here
  linkRef: ObjectRefOf<any>;
  blockInterface: InterfaceRefOf<BlockShape>;
  blockListRef: ObjectRefOf<BlockListShape>;
  /** Keyed by the items field's synthetic content type id. */
  itemTypes: Map<string, ItemType>;
}

export function fieldMapper(manablox: Manablox, refs: FieldRefs): FieldMapper {
  const { assetRef, userRef, contentInterface, linkRef, blockInterface, blockListRef, itemTypes } =
    refs;

  return (t, type, pick) => {
    // biome-ignore lint/suspicious/noExplicitAny: field refs are opaque to us here
    const out: Record<string, any> = {};

    for (const field of type.fields) {
      const fieldType = manablox.fieldTypes.tryGet(field.type);
      if (!fieldType) continue;

      // Role-gated fields are left out of the public schema, not nulled.
      if (field.readRoles?.length) continue;

      const spec = resolveGraphQL(fieldType, field.settings);
      const gqlName = camelCase(field.name);

      switch (spec.type.kind) {
        case 'scalar':
          out[gqlName] = t.field({
            type: spec.list ? [spec.type.name] : spec.type.name,
            nullable: !field.required,
            resolve: (parent: never) => pick(parent)[field.name] ?? null,
          });
          break;

        case 'ref':
          out[gqlName] = t.field({
            type: spec.list
              ? [
                  spec.type.target === 'asset'
                    ? assetRef
                    : spec.type.target === 'user'
                      ? userRef
                      : contentInterface,
                ]
              : spec.type.target === 'asset'
                ? assetRef
                : spec.type.target === 'user'
                  ? userRef
                  : contentInterface,
            nullable: !field.required,
            resolve: (parent: never, _args: unknown, ctx: GraphQLContext) => {
              const target = spec.type.kind === 'ref' ? spec.type.target : 'content';
              // A `filter` relation stores nothing; its query runs on every read.
              return isFilterRelation(field.settings)
                ? resolveRelationQuery(ctx, target, field.id, field.settings, localeOf(parent))
                : resolveReference(ctx, target, pick(parent)[field.name], spec.list ?? false);
            },
          });
          break;

        case 'link':
          out[gqlName] = t.field({
            type: linkRef,
            nullable: !field.required,
            resolve: (parent: never) => pick(parent)[field.name] ?? null,
          });
          break;

        case 'block':
          out[gqlName] = spec.list
            ? t.field({
                type: blockListRef,
                nullable: false,
                resolve: (parent: never) => {
                  const value = pick(parent)[field.name];
                  return {
                    grid: blockGridOf(value),
                    blocks: withLocale(fieldBlocks(fieldType, value, field.settings), parent),
                  };
                },
              })
            : t.field({
                type: blockInterface,
                nullable: !field.required,
                resolve: (parent: never) => {
                  const block = pick(parent)[field.name] as BlockShape | null | undefined;
                  return block ? withLocale([block], parent)[0] : null;
                },
              });
          break;

        // A template's blocks; tracked so publishing the template invalidates its users.
        case 'blockRef':
          out[gqlName] = t.field({
            type: blockListRef,
            nullable: false,
            resolve: async (parent: never, _args: unknown, ctx: GraphQLContext) => {
              const id = pick(parent)[field.name];
              if (typeof id !== 'string') return { grid: null, blocks: [] };
              const row = await ctx.reader.byId(id);
              if (!row) return { grid: null, blocks: [] };
              const value = readTemplateBlocks(ctx.manablox.contentTypes, row);
              return { grid: blockGridOf(value), blocks: withLocale(value?.blocks ?? [], parent) };
            },
          });
          break;

        case 'items': {
          const item = itemTypes.get(itemsContentType(type, field, []).id);
          if (!item) break;
          out[gqlName] = t.field({
            type: [item.ref],
            nullable: false,
            resolve: (parent: never) =>
              withLocale(fieldItems(fieldType, pick(parent)[field.name], field.settings), parent),
          });
          break;
        }
      }
    }

    return out;
  };
}
