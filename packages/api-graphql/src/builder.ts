import type { BlockGridSettings, BlockLayout } from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import type { ImplementableObjectRef, InterfaceRef, ObjectRef } from '@pothos/core';
import type { GraphQLContext } from './context.js';

export type Types = {
  Context: GraphQLContext;
  Scalars: {
    DateTime: { Input: Date; Output: Date | string };
    JSON: { Input: unknown; Output: unknown };
  };
};

type SchemaTypes = PothosSchemaTypes.ExtendDefaultTypes<Types>;
export type Builder = PothosSchemaTypes.SchemaBuilder<SchemaTypes>;
export type ObjectRefOf<T> = ObjectRef<SchemaTypes, T>;
export type ImplementableRefOf<T> = ImplementableObjectRef<SchemaTypes, T>;
export type InterfaceRefOf<T> = InterfaceRef<SchemaTypes, T>;

export interface ContentPageShape {
  items: ContentRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface BlockListShape {
  grid: BlockGridSettings | null;
  blocks: BlockShape[];
}

export interface BlockShape {
  blockId: string;
  type: string;
  fields: Record<string, unknown>;
  layout?: BlockLayout;
  ext?: Record<string, unknown>;
}

/** `meta_description` -> `metaDescription`, so the schema reads as idiomatic GraphQL. */
export function camelCase(name: string): string {
  return name.replace(/[_-]+(.)/g, (_match, char: string) => char.toUpperCase());
}
