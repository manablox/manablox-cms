import {
  type ContentTypeDefinition,
  type FieldDefinition,
  graphqlTypeName,
  isDocumentType,
  type TypeScope,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow } from '@manablox/db';
import SchemaBuilder from '@pothos/core';
import type { GraphQLSchema } from 'graphql';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import type { BlockShape, Builder, ObjectRefOf, Types } from './builder.js';
import { fieldMapper } from './fields.js';
import { defineRoot, withoutSpaceArgument } from './root.js';
import { defineAssetTypes } from './types/asset.js';
import { defineBlockInterfaces, defineBlockTypes } from './types/block.js';
import { defineContentInterface, defineContentTypes } from './types/content.js';
import { defineItemRefs, defineItemTypes } from './types/items.js';
import { defineMenuRefs, implementMenuItem } from './types/menu.js';

/** Options for the delivery schema, which has one object type per content type. */
export interface BuildSchemaOptions {
  /** The instance serves one space; `spaceId` is removed from the schema, not ignored. */
  pinnedSpace?: boolean;
  /**
   * The space (or space environment) whose types the schema holds, since type names may
   * repeat across spaces. Undefined takes every space's production types, keeping the first
   * of any colliding name.
   */
  spaceId?: TypeScope | undefined;
}

export function buildSchema(manablox: Manablox, options: BuildSchemaOptions = {}): GraphQLSchema {
  const builder: Builder = new SchemaBuilder<Types>({});
  const pinnedSpace = options.pinnedSpace ?? false;

  builder.addScalarType('DateTime', GraphQLDateTime);
  builder.addScalarType('JSON', GraphQLJSON);

  // Registration order is the printed schema's type order.
  const { tagRef, assetRef, userRef } = defineAssetTypes(builder);

  const scoped = scopedTypes(manablox, options.spaceId);
  // Databags are documents too, outside the tree.
  const contentTypes = scoped.filter(isDocumentType);
  const blockTypes = scoped.filter((type) => !isDocumentType(type));

  const { menuItemRef, menuRef } = defineMenuRefs(builder);

  const contentRefs = new Map<string, ObjectRefOf<ContentRow>>();
  const blockRefs = new Map<string, ObjectRefOf<BlockShape>>();
  for (const type of contentTypes) {
    contentRefs.set(type.id, builder.objectRef<ContentRow>(graphqlTypeName(type.name)));
  }
  for (const type of blockTypes) {
    blockRefs.set(type.id, builder.objectRef<BlockShape>(graphqlTypeName(type.name)));
  }

  const itemTypes = defineItemRefs(builder, manablox, scoped);

  const { contentInterface, linkRef } = defineContentInterface(builder, manablox, tagRef);
  implementMenuItem(menuItemRef, contentInterface);
  const { blockInterface, blockListRef } = defineBlockInterfaces(builder, manablox);

  const buildFieldMap = fieldMapper(manablox, {
    assetRef,
    userRef,
    contentInterface,
    linkRef,
    blockInterface,
    blockListRef,
    itemTypes,
  });
  defineItemTypes(builder, itemTypes, buildFieldMap);
  defineBlockTypes(builder, blockTypes, blockRefs, blockInterface, buildFieldMap);
  defineContentTypes(builder, contentTypes, contentRefs, contentInterface, buildFieldMap);

  defineRoot(builder, { contentInterface, menuRef, assetRef }, pinnedSpace);

  const schema = builder.toSchema();
  return pinnedSpace ? withoutSpaceArgument(schema) : schema;
}

/**
 * A space's types plus the global ones, or with no space every type, dropping later
 * cross-space name collisions.
 */
function scopedTypes(manablox: Manablox, spaceId: TypeScope | undefined): ContentTypeDefinition[] {
  if (spaceId !== undefined) return manablox.contentTypes.forSpace(spaceId);

  const seen = new Map<string, ContentTypeDefinition>();
  for (const type of manablox.contentTypes.all) {
    if (type.environmentId) continue;
    const name = graphqlTypeName(type.name);
    const kept = seen.get(name);
    if (!kept) {
      seen.set(name, type);
      continue;
    }
    manablox.logger.warn(
      { graphqlName: name, kept: kept.spaceId, dropped: type.spaceId },
      'two spaces declare this content type; the schema without a space header keeps one of them',
    );
  }
  return [...seen.values()];
}

export type { FieldDefinition };
