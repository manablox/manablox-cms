/**
 * A document, with field values also flattened onto it (`page.summary`). Run
 * `manablox-sdk types` to generate typed fields.
 */
export interface ContentNode {
  id: string;
  type: string;
  title: string;
  slug: string;
  permalink: string | null;
  locale: string;
  publishedAt: string | null;
  updatedAt: string;
  fields: Record<string, unknown>;
  /** Shared by every translation of the document. */
  tags?: Tag[];
  [field: string]: unknown;
}

/** A tag; `slug` is what `ListArgs.tags` filters by. */
export interface Tag {
  name: string;
  slug: string;
}

/** A menu entry's HTML `target`. */
export type MenuItemTarget = '_self' | '_blank';

/** A menu entry: a document or a `url`, with `href` set for either. */
export interface MenuItem<T extends ContentNode = ContentNode> {
  id: string;
  /** The editor's override, or the document's title. */
  label: string;
  /** Set for a link entry. */
  url: string | null;
  /** Set for a content entry. */
  content: T | null;
  /** `url` for a link, the root-relative permalink for a content entry. */
  href: string | null;
  /** The anchor's HTML `target`. */
  target: MenuItemTarget;
  children: MenuItem<T>[];
}

export interface Menu<T extends ContentNode = ContentNode> {
  id: string;
  name: string;
  machineName: string;
  items: MenuItem<T>[];
}

/**
 * A redirect of the requested locale. Paths have a leading slash and no locale prefix; a
 * frontend adds its own prefix scheme.
 */
export interface Redirect {
  /** `null`: it applies to every locale. */
  locale: string | null;
  fromPath: string;
  /** A path like `fromPath`, or an absolute `http(s)` URL. */
  toPath: string;
  /** `301` or `302`. */
  status: number;
  /** The target document's id; `null` for a path target. */
  contentId: string | null;
}

export type BlockBreakpoint = 'desktop' | 'tablet' | 'mobile';

/** Where a block sits on its field's grid at one breakpoint, in 1-based CSS grid lines. */
export interface BlockPlacement {
  column?: number | undefined;
  row?: number | undefined;
  columnSpan?: number | undefined;
  rowSpan?: number | undefined;
}

/** A block's grid placement, with narrower-breakpoint overrides. See `blockLayoutStyle()`. */
export interface BlockLayout extends BlockPlacement {
  tablet?: BlockPlacement | undefined;
  mobile?: BlockPlacement | undefined;
}

export interface BlockGrid {
  columns: number;
  rows?: number | undefined;
}

/** A `blocks` field's grid at every breakpoint, as delivered with the value. */
export type BlockGridSettings = Record<BlockBreakpoint, BlockGrid>;

/** The grid as stored: only the breakpoints an editor set. */
export interface BlockGridValue {
  desktop?: BlockGrid | undefined;
  tablet?: BlockGrid | undefined;
  mobile?: BlockGrid | undefined;
}

/** A `blocks` field: the blocks and their grid per breakpoint (`null` for a plain list). */
export interface BlocksValue<T extends Block = Block> {
  grid: BlockGridSettings | null;
  blocks: T[];
}

/**
 * A `link` field, internal or external. `href` is the resolved address, `null` when an
 * internal target is gone or unpublished.
 */
export interface LinkValue {
  mode: 'internal' | 'external';
  contentId: string | null;
  url: string | null;
  href: string | null;
  target: '_self' | '_blank';
  label: string | null;
  /** The referenced document, when the field was named in `expand`. */
  content?: ContentNode | null;
}

export interface Block {
  blockId: string;
  type: string;
  fields: Record<string, unknown>;
  layout?: BlockLayout | null;
  /** Field values flattened alongside, and plugin data such as a designed site's `design`. */
  [key: string]: unknown;
}

/** A repeater item; like a block, its values sit in `fields` and alongside. */
export interface FieldItem {
  itemId: string;
  fields: Record<string, unknown>;
  [field: string]: unknown;
}

export interface Asset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  title: string | null;
  /** Where the subject is, as fractions of the (cropped) image; `null` means centred. */
  focalPoint?: { x: number; y: number } | null;
  /** The editor's crop in the original's pixels; variants are already cut to it. */
  crop?: { left: number; top: number; width: number; height: number } | null;
  /** Signed transform URLs keyed by preset name. See `assetUrl`. */
  variants?: Record<string, string>;
  /** The tags the space gives it. */
  tags?: Tag[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListArgs {
  type?: string;
  parentId?: string;
  under?: string;
  search?: string;
  /** Tag slugs; a document carrying any of them matches. */
  tags?: string[];
  limit?: number;
  offset?: number;
}

/** Per-call options both transports honour. */
export interface RequestOptions {
  locale?: string;
  /** Relation fields to inline. REST uses `?expand=`; GraphQL resolves them anyway. */
  expand?: string[];
  /** GraphQL selection set; ignored by REST. */
  selection?: string;
  signal?: AbortSignal;
  /** Skip the in-memory cache for this call. */
  fresh?: boolean;
}

/** The content model, as `/v1/types` describes it. Used by the type generator. */
export interface ContentModel {
  types: ContentModelType[];
}

export interface ContentModelType {
  name: string;
  label: string;
  kind: 'content' | 'block' | 'data';
  fields: ContentModelField[];
}

export interface ContentModelField {
  name: string;
  type: string;
  required: boolean;
  list: boolean;
  kind: 'scalar' | 'ref' | 'block' | 'blockRef' | 'link' | 'items';
  scalar?: string;
  target?: 'content' | 'asset' | 'user';
  blockTypes?: string[];
  /** What each item holds, for `items` fields. */
  fields?: ContentModelField[];
}
