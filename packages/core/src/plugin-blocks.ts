/** Plugin data on block instances (`BlockValue.ext`) and on code content types. */

import type { ContentTypeDefinition } from './types.js';

/** A problem with a plugin's data; `path` is relative to that data. */
export interface PluginDataIssue {
  path?: readonly (string | number)[] | undefined;
  message: string;
}

/** What a block instance check gets. */
export interface BlockInstanceContext {
  /** The block's type id. */
  type: string;
  spaceId: string | null;
  locale: string;
}

/** Checks the plugin's entry in `BlockValue.ext` when a document is saved. */
export interface PluginBlockInstance {
  /** Problems of a value; none when it is valid. Synchronous. */
  validate(value: unknown, context: BlockInstanceContext): readonly PluginDataIssue[];
  /** The value to store; `undefined` stores nothing. */
  strip?(value: unknown): unknown;
}

/** Delivers the plugin's entry on REST and GraphQL blocks. */
export interface PluginBlockPublicApi {
  /** The block key it is delivered at. */
  field: string;
  /** The delivered value; `undefined` or `null` leaves the key out. */
  serialize(value: unknown): unknown;
}

/** The GraphQL field of `publicApi`; `@manablox/api-graphql` adds its type. */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by @manablox/api-graphql
export interface PluginBlockGraphql {}

/** A plugin's data on block instances, stored at `ext.<id>`. See https://dev.manablox.io/extending/block-extensions/. */
export interface PluginBlocks {
  instance?: PluginBlockInstance;
  /** Without it the data stays in the management API. */
  publicApi?: PluginBlockPublicApi;
  /** Needs `publicApi`, which names the field and gives its value. */
  graphql?: PluginBlockGraphql;
}

/** Checks the plugin's entry in `ContentTypeInput.plugins` when the config resolves. */
export interface PluginContentTypeData {
  /** Problems of a value; none when it is valid. */
  validate(value: unknown, type: ContentTypeDefinition): readonly PluginDataIssue[];
}

/** An issue as `<path> <message>`. */
export function formatDataIssue(issue: PluginDataIssue): string {
  return issue.path?.length ? `${issue.path.join('.')} ${issue.message}` : issue.message;
}
