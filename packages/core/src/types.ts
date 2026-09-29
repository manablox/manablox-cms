import type { ResourceSource } from './code-resource.js';
import type { PluginBlockInstance } from './plugin-blocks.js';
import type { StandardSchemaV1 } from './standard-schema.js';

/** `Partial<T>` that also accepts `undefined` under `exactOptionalPropertyTypes`. For DTOs. */
export type Loose<T> = { [K in keyof T]?: T[K] | undefined };

// Field types

/** Operators a field type declares support for. The query layer allowlists against this. */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull';

export type PostgresColumnType =
  | 'text'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'boolean'
  | 'timestamptz'
  | 'date'
  | 'uuid'
  | 'jsonb';

export interface FieldStorage {
  /** `jsonb` lives in `contents.fields`; `column` promotes it to a real column for hot paths. */
  kind: 'jsonb' | 'column';
  columnType?: PostgresColumnType;
  /** Expression index over the JSONB path, or a plain index on the promoted column. */
  index?: false | 'btree' | 'gin' | 'trgm';
}

/** How a field surfaces in GraphQL. Core imports no `graphql`; only `api-graphql` does. */
export type GraphQLTypeSpec =
  | { kind: 'scalar'; name: 'String' | 'Int' | 'Float' | 'Boolean' | 'DateTime' | 'JSON' | 'ID' }
  | { kind: 'ref'; target: 'content' | 'asset' | 'user' }
  | { kind: 'block' }
  /** A document id whose blocks delivery inlines here. */
  | { kind: 'blockRef' }
  /** A document (resolved to its permalink by delivery) or an external address. */
  | { kind: 'link' }
  /** Items following the field's `subFields`, e.g. repeater rows. */
  | { kind: 'items' };

export interface GraphQLFieldSpec {
  type: GraphQLTypeSpec;
  list?: boolean;
  nullable?: boolean;
}

/** A reference this field's value holds, used to batch-load relations via DataLoader. */
export interface FieldReference {
  target: 'content' | 'asset' | 'user';
  id: string;
}

export interface FieldValueContext {
  /** The content type that owns the field. */
  contentType: ContentTypeDefinition;
  field: FieldDefinition;
  locale: string;
  spaceId: string | null;
  /** Block data checks of the plugins on for the space, by plugin id; the field drops other `ext` entries. */
  blockExtensions?: ReadonlyMap<string, PluginBlockInstance> | undefined;
}

export interface FieldTypeDefinition<TSettings = Record<string, unknown>, TValue = unknown> {
  /** Machine name, unique across the registry. Also the storage discriminator. */
  name: string;
  label: string;
  icon?: string;
  description?: string;

  /** True when the value contains nested blocks, so traversal recurses into it. */
  nested?: boolean;

  /** Validates the settings a content-type author configures. */
  settingsSchema: StandardSchemaV1<unknown, TSettings>;

  /** Builds the value schema from those settings. */
  valueSchema: (
    settings: TSettings,
    context: FieldValueContext,
  ) => StandardSchemaV1<unknown, TValue>;

  /** Value for a fresh field. `null` means unfilled and skips validation unless required. */
  defaultValue: (settings: TSettings) => TValue | null;

  /**
   * Whether a value counts as unfilled, so `required` rejects it and `unique` skips it.
   * `null` always does. Also called with unvalidated input, so check the shape.
   */
  isEmpty?: (value: TValue, settings: TSettings) => boolean;

  /** Whether the `unique` rule applies; values compare by JSON equality. Off when omitted. */
  unique?: boolean | ((settings: TSettings) => boolean);

  storage: FieldStorage | ((settings: TSettings) => FieldStorage);
  filters: FilterOperator[];
  graphql: GraphQLFieldSpec | ((settings: TSettings) => GraphQLFieldSpec);

  /** Text contributed to the content's full-text `tsvector`. */
  search?: (value: TValue, settings: TSettings) => string | null;

  /** References held by the value, for batched relation loading. */
  references?: (value: TValue, settings: TSettings) => FieldReference[];

  /** Nested blocks held by the value, for recursive validation and traversal. */
  blocks?: (value: TValue, settings: TSettings) => BlockValue[];

  /** Inline definitions every item of the value follows; walkers recurse into `items`. */
  subFields?: (settings: TSettings) => FieldDefinition[];

  /** Items held by the value, each filled against `subFields`. */
  items?: (value: TValue, settings: TSettings) => FieldItem[];

  /** Component keys, not imports, since these definitions also load on the server. */
  admin: {
    input: string;
    settings?: string;
    /** Renders the collapsed summary of a block in the block editor. */
    summary?: boolean;
  };
}

/** Generics erased for the registry; `never` and `unknown` would break assignability. */
// biome-ignore lint/suspicious/noExplicitAny: type erasure for the heterogeneous registry
export type AnyFieldType = FieldTypeDefinition<any, any>;

// Content types

export interface FieldAdminSettings {
  zone: 'main' | 'sidebar';
  /** Percentage width within the zone. */
  width: number;
  help?: string;
  placeholder?: string;
  position: number;
}

export interface FieldDefinition<TSettings = Record<string, unknown>> {
  /** Stable identifier; survives renames of `label`. */
  id: string;
  /** Machine name. Immutable: it is in the public GraphQL schema. */
  name: string;
  label: string;
  type: string;
  settings: TSettings;
  required: boolean;
  localized: boolean;
  unique: boolean;
  readRoles?: string[];
  writeRoles?: string[];
  admin: FieldAdminSettings;
}

export const CONTENT_TYPE_KINDS = ['content', 'block', 'data'] as const;

export type ContentTypeKind = (typeof CONTENT_TYPE_KINDS)[number];

/** Content and data types: their documents stand alone, unlike blocks. */
export function isDocumentType(type: { kind: ContentTypeKind }): boolean {
  return type.kind !== 'block';
}

/** Whether a document of this type may sit under a parent. */
export function canNest(type: { kind: ContentTypeKind }): boolean {
  return type.kind === 'content';
}

/** Whether documents of this type may have children. */
export function canHoldChildren(type: { kind: ContentTypeKind }): boolean {
  return type.kind === 'content';
}

export interface ContentTypeDefinition {
  id: string;
  /** Machine name, unique per space. Becomes the GraphQL type name. */
  name: string;
  label: string;
  description?: string;
  icon?: string;
  /** `block` types are embedded in a block field; `data` types are flat records outside the tree. */
  kind: ContentTypeKind;
  /** `null` means global - available in every space. */
  spaceId: string | null;
  /** Staging types only: their environment. Production and global types have none. */
  environmentId?: string;
  hasSlug: boolean;
  isPublishable: boolean;
  isVisibleInTree: boolean;
  canBeVisibleInMenu: boolean;
  /** Whether documents go through review. Only on publishable types. */
  requiresApproval: boolean;
  fields: FieldDefinition[];
  /** The built-in folder and template types, left out of type pickers. */
  isSystem: boolean;
  /** Where the definition came from. `code` types are read-only in the admin. */
  source: 'code' | 'runtime';
  /** Code types: data for plugins by plugin id, checked by each plugin's `contentTypes.validate`. */
  plugins?: Record<string, unknown>;
}

// Content values

/** The three widths a block grid is laid out for; the CSS thresholds live with the SDK. */
export type BlockBreakpoint = 'desktop' | 'tablet' | 'mobile';
export const BLOCK_BREAKPOINTS: readonly BlockBreakpoint[] = ['desktop', 'tablet', 'mobile'];

/** 1-based CSS grid lines at one breakpoint. Missing coordinates auto-place; spans default to 1. */
export interface BlockPlacement {
  // Explicit `| undefined` so Zod's `.optional()` fits `exactOptionalPropertyTypes`.
  column?: number | undefined;
  row?: number | undefined;
  columnSpan?: number | undefined;
  rowSpan?: number | undefined;
}

/**
 * Desktop placement at the top level, narrower breakpoints nested where they differ. A
 * breakpoint without one follows desktop if the columns match, else is auto-placed.
 */
export interface BlockLayout extends BlockPlacement {
  tablet?: BlockPlacement | undefined;
  mobile?: BlockPlacement | undefined;
}

/** One breakpoint's grid: how many columns, and a fixed row count where there is one. */
export interface BlockGrid {
  columns: number;
  rows?: number | undefined;
}

/** A `blocks` field's grid at every breakpoint, resolved from the value's `grid`. */
export type BlockGridSettings = Record<BlockBreakpoint, BlockGrid>;

/**
 * Only the breakpoints an editor set. Tablet follows desktop, mobile is one column;
 * absent altogether, the field is a plain list.
 */
export interface BlockGridValue {
  desktop?: BlockGrid | undefined;
  tablet?: BlockGrid | undefined;
  mobile?: BlockGrid | undefined;
}

/** The blocks and their grid; the grid is per document, not per type. */
export interface BlocksValue {
  grid?: BlockGridValue | undefined;
  blocks: BlockValue[];
}

export interface BlockValue {
  blockId: string;
  /** Content type id of a `kind: 'block'` type. */
  type: string;
  fields: Record<string, unknown>;
  layout?: BlockLayout | undefined;
  /** Plugin data by plugin id, checked by each plugin's `blocks.instance`; never delivered raw. */
  ext?: Record<string, unknown> | undefined;
}

/** One entry of a field with `subFields`, like a repeater row. */
export interface FieldItem {
  itemId: string;
  fields: Record<string, unknown>;
}

export type ContentStatus = 'draft' | 'published' | 'archived';

/** Where a menu entry opens, as the HTML `target` attribute. */
export type MenuItemTarget = '_self' | '_blank';

export const MENU_ITEM_TARGETS: readonly MenuItemTarget[] = ['_self', '_blank'];

export interface ContentRecord {
  id: string;
  spaceId: string;
  /** The space environment the document belongs to. */
  environmentId: string;
  typeId: string;
  locale: string;
  /** Shared across the translations of one logical document. */
  localizationId: string;
  parentId: string | null;
  title: string;
  slug: string;
  /** Materialised `ltree` path of ancestor ids. */
  path: string;
  /** Routable URL path; NULL when the content type has no slug. */
  permalink: string | null;
  /** Accumulated permalink prefix, including slug-less ancestors' skipped levels. */
  permalinkPath: string;
  /** This node's own permalink contribution, or NULL when the type has no slug. */
  permalinkSegment: string | null;
  status: ContentStatus;
  position: number;
  fields: Record<string, unknown>;
  /** Concatenated `search()` contributions from each field type; `null` on published reads. */
  searchText: string | null;
  /** Generated `tsvector`; read-only, never written. */
  search: string | null;
  version: number;
  /** `code` on a document a managed template declaration owns. */
  source: ResourceSource;
  sourceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: Date | null;
  /** When the scheduler should publish this document; null once it has, or never. */
  publishAt: Date | null;
  /** When the scheduler should take it down again; null when the window has no end. */
  unpublishAt: Date | null;
}
