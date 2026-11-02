import type { Builder } from '@manablox/api-graphql';
import type { PluginBlocks } from '@manablox/core';
import type { BlockInstanceDesign } from '@manablox/site';
import { websiteBlockDelivery, websiteBlockInstance } from './services/site/blocks.js';

/** A block's design at `ext.website`, delivered as `design`. */
export const websiteBlocks: PluginBlocks = {
  instance: websiteBlockInstance,
  publicApi: websiteBlockDelivery,
  graphql: {
    type: (builder: Builder) =>
      builder.objectRef<BlockInstanceDesign>('BlockDesign').implement({
        description:
          "An editor's design choice for one block: a variant of its block design and style overrides by theme token.",
        fields: (t) => ({
          /** A variant name; a variant the design lacks renders the default. */
          variant: t.string({ nullable: true, resolve: (design) => design.variant ?? null }),
          /** Background, padding, gap, text alignment, width and hidden breakpoints. */
          style: t.field({
            type: 'JSON',
            nullable: true,
            resolve: (design) => design.style ?? null,
          }),
        }),
      }),
  },
};
