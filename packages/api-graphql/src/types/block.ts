import { type ContentTypeDefinition, graphqlTypeName, pluginId } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type BlockDelivery, blockDeliveries } from '@manablox/services';
import type { OutputRef } from '@pothos/core';
import type {
  BlockListShape,
  BlockShape,
  Builder,
  InterfaceRefOf,
  ObjectRefOf,
} from '../builder.js';
import type { GraphQLContext } from '../context.js';
import type { FieldMapper } from '../fields.js';

declare module '@manablox/core' {
  interface PluginBlockGraphql {
    /** The field's type, built once per schema. */
    type(builder: Builder): OutputRef<unknown>;
    description?: string;
  }
}

/** Plugin block data delivered in the request's space, looked up once per request. */
const deliveries = new WeakMap<GraphQLContext, Promise<BlockDelivery[]>>();
function deliveriesOf(ctx: GraphQLContext): Promise<BlockDelivery[]> {
  let found = deliveries.get(ctx);
  if (!found) {
    found = blockDeliveries(ctx.manablox, ctx.spaceId);
    deliveries.set(ctx, found);
  }
  return found;
}

/** The `Block` interface and `BlockList`, a `blocks` field's value. */
export function defineBlockInterfaces(builder: Builder, manablox: Manablox) {
  const extensions = manablox.config.plugins.flatMap((plugin) => {
    const { publicApi, graphql } = plugin.blocks ?? {};
    return publicApi && graphql
      ? [
          {
            id: pluginId(plugin.name),
            field: publicApi.field,
            graphql,
            type: graphql.type(builder),
          },
        ]
      : [];
  });

  const blockInterface = builder.interfaceRef<BlockShape>('Block').implement({
    fields: (t) => ({
      blockId: t.exposeID('blockId'),
      typeName: t.string({
        resolve: (block, _a, ctx) => ctx.manablox.contentTypes.get(block.type).name,
      }),
      /** Grid position (`column`, `row`, `columnSpan`, `rowSpan`), where the field is a grid. */
      layout: t.field({
        type: 'JSON',
        nullable: true,
        resolve: (block) => block.layout ?? null,
      }),
      // Plugin data, `null` where the plugin is off or has nothing to deliver.
      ...Object.fromEntries(
        extensions.map((extension) => [
          extension.field,
          t.field({
            // The plugin's ref carries the schema type; its shape is the serialized value.
            type: extension.type as unknown as 'JSON',
            nullable: true,
            ...(extension.graphql.description
              ? { description: extension.graphql.description }
              : {}),
            resolve: (block, _a, ctx) => {
              const value = block.ext?.[extension.id];
              if (value === undefined) return null;
              const serialize = (deliveries: BlockDelivery[]) =>
                deliveries.find((entry) => entry.id === extension.id)?.serialize(value) ?? null;
              // Synchronous when the context has them, so response keys keep the query's order.
              return ctx.blockData ? serialize(ctx.blockData) : deliveriesOf(ctx).then(serialize);
            },
          }),
        ]),
      ),
    }),
    resolveType: (block) => graphqlTypeName(manablox.contentTypes.get(block.type).name),
  });

  /** A `blocks` field: the blocks and their grid (`null` for a plain list). */
  const blockListRef = builder.objectRef<BlockListShape>('BlockList').implement({
    fields: (t) => ({
      grid: t.field({ type: 'JSON', nullable: true, resolve: (list) => list.grid }),
      blocks: t.field({ type: [blockInterface], resolve: (list) => list.blocks }),
    }),
  });

  return { blockInterface, blockListRef };
}

/** One object type per block type. */
export function defineBlockTypes(
  builder: Builder,
  blockTypes: ContentTypeDefinition[],
  blockRefs: Map<string, ObjectRefOf<BlockShape>>,
  blockInterface: InterfaceRefOf<BlockShape>,
  buildFieldMap: FieldMapper,
): void {
  for (const type of blockTypes) {
    const ref = blockRefs.get(type.id);
    if (!ref) continue;
    builder.objectType(ref, {
      interfaces: [blockInterface],
      isTypeOf: (value) => (value as BlockShape).type === type.id,
      fields: (t) => buildFieldMap(t, type, (block: BlockShape) => block.fields),
    });
  }
}
