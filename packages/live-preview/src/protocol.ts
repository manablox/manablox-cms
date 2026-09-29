import type { BlockBreakpoint, BlockGridSettings, BlockPlacement } from '@manablox/public-sdk';

/** The visual-editor channel: versioned, typed, and origin-checked on both sides. */
export const PROTOCOL_VERSION = 1 as const;

type V = typeof PROTOCOL_VERSION;

export type {
  BlockBreakpoint,
  BlockGrid,
  BlockGridSettings,
  BlockLayout,
  BlockPlacement,
} from '@manablox/public-sdk';
export { BREAKPOINT_MAX, breakpointFor } from '@manablox/public-sdk';

export type FieldPath = (string | number)[];

export interface PreviewDocument {
  id: string | null;
  typeId: string;
  typeName: string;
  locale: string;
  title: string;
  slug: string;
  permalink: string | null;
  fields: Record<string, unknown>;
}

/** What a field accepts when edited in place. */
export type InlineKind = 'text' | 'richtext';

/** How a field is edited in place; rich text lists its toolbar tools. */
export type InlineEditable = { kind: 'text' } | { kind: 'richtext'; toolbar: string[] };

/** Editor-side metadata (editable fields, block labels, grids), keyed by joined path. */
export interface PreviewMeta {
  editable: Record<string, InlineEditable>;
  labels: Record<string, string>;
  grids: Record<string, BlockGridSettings>;
  /** The viewer may not edit: selection only, no inline edits or block toolbar. */
  readOnly?: boolean | undefined;
}

export interface PreviewCapabilities {
  /** Clicking a tagged field selects it in the editor. */
  fields: boolean;
  /** The frame shows a toolbar on each block: move, resize, add, delete. */
  blocks: boolean;
  /** Text and rich text can be edited in the frame. */
  inline: boolean;
  /** The plugin channels the frame handles. */
  plugins?: string[] | undefined;
}

/** A plugin's message, in either direction. */
export interface PluginMessage {
  v: V;
  kind: 'plugin';
  plugin: string;
  name: string;
  payload: unknown;
}

/** A plugin channel's messages: name -> payload, per direction. */
export interface PluginChannelMap {
  toPreview: Record<string, unknown>;
  toEditor: Record<string, unknown>;
}

/** The two ends of one plugin channel. */
export interface PluginChannel<
  Send extends Record<string, unknown>,
  Receive extends Record<string, unknown>,
> {
  send<K extends keyof Send & string>(name: K, payload: Send[K]): void;
  /** Returns the unsubscribe function. */
  on<K extends keyof Receive & string>(name: K, handler: (payload: Receive[K]) => void): () => void;
}

export function isPluginMessage(value: unknown): value is PluginMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<PluginMessage>;
  return (
    message.v === PROTOCOL_VERSION &&
    message.kind === 'plugin' &&
    typeof message.plugin === 'string' &&
    typeof message.name === 'string'
  );
}

/** Editor -> preview. */
export type EditorMessage =
  | { v: V; kind: 'document'; document: PreviewDocument; meta: PreviewMeta }
  | { v: V; kind: 'highlight'; path: FieldPath | null }
  | PluginMessage;

/** Preview -> editor requests; the editor applies them and sends the document back. */
export type PreviewMessage =
  | { v: V; kind: 'ready'; capabilities: PreviewCapabilities }
  | { v: V; kind: 'moveBlock'; list: FieldPath; from: number; to: number }
  | { v: V; kind: 'removeBlock'; list: FieldPath; index: number }
  | { v: V; kind: 'addBlock'; list: FieldPath; index: number }
  | {
      v: V;
      kind: 'layoutBlock';
      list: FieldPath;
      index: number;
      breakpoint: BlockBreakpoint;
      placement: BlockPlacement | null;
    }
  | { v: V; kind: 'editField'; path: FieldPath; inline: InlineKind; text: string; html: string }
  | { v: V; kind: 'selectField'; path: FieldPath }
  | { v: V; kind: 'requestSave' }
  | PluginMessage;

/** A message of this version; receivers ignore a `kind` they do not handle. */
function isChannelMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { v?: unknown; kind?: unknown };
  return message.v === PROTOCOL_VERSION && typeof message.kind === 'string';
}

export function isEditorMessage(value: unknown): value is EditorMessage {
  return isChannelMessage(value);
}

export function isPreviewMessage(value: unknown): value is PreviewMessage {
  return isChannelMessage(value);
}

/** Marks an element as the rendering of one field, enabling click-to-edit. */
export const FIELD_ATTRIBUTE = 'data-manablox-field';

/** Marks the element holding a block list, for adding into empty lists and grid drags. */
export const LIST_ATTRIBUTE = 'data-manablox-list';

export function fieldAttribute(path: FieldPath): Record<string, string> {
  return { [FIELD_ATTRIBUTE]: path.join('.') };
}

export function listAttribute(path: FieldPath): Record<string, string> {
  return { [LIST_ATTRIBUTE]: path.join('.') };
}

export function parseFieldPath(value: string): FieldPath {
  if (value === '') return [];
  return value.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** Whether the path ends in an index, naming a block in a list. */
export function isBlockPath(path: FieldPath): boolean {
  return path.length >= 2 && typeof path[path.length - 1] === 'number';
}

export function samePath(a: FieldPath | null, b: FieldPath | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/** For a field inside a block (`components.2.headline`), the block it belongs to. */
export function blockPathWithin(path: FieldPath): FieldPath | null {
  for (let end = path.length; end >= 2; end -= 1) {
    const candidate = path.slice(0, end);
    if (isBlockPath(candidate)) return candidate;
  }
  return null;
}
