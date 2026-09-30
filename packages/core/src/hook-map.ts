// `scripts/hook-docs.mjs` reads `ManabloxHooks` from this source into `hook-docs.ts` (the
// `@manablox/core/hook-docs` entry) for the hooks reference: a `// Section` comment per table
// and one entry per hook. Run `pnpm --filter @manablox/core hooks` after changing it.
import type { ContentTypeInput } from './content-type.js';
import type { Manablox } from './manablox.node.js';
import type { RedirectSource } from './redirects.js';
import type { ContentRecord, ContentTypeDefinition, FieldDefinition } from './types.js';

export interface HookContextBase {
  manablox: Manablox;
  /** Present for request-scoped hooks. */
  actor?: { userId: string; roles: string[] } | null;
  spaceId?: string | null;
  /** The environment of `spaceId` the hook runs for, where one applies. */
  environmentId?: string | null | undefined;
}

/**
 * Services bound to the write a content hook runs in: inside a transaction they write through
 * it, after commit they are the root ones. Filled in by `@manablox/services`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by @manablox/services
export interface HookServices {}

export interface ContentHookContext extends HookContextBase {
  contentType: ContentTypeDefinition;
  /** On an update: the row before the write. */
  previous?: ContentRecord | null;
  /** Set on write hooks; write through these, not through services held elsewhere. */
  services?: HookServices;
}

/** Rows of one `content:afterReadMany` page may span types; resolve each via `manablox.contentTypes`. */
export interface ContentReadManyHookContext extends HookContextBase {
  actor: { userId: string; roles: string[] } | null;
  spaceId: string | null;
  /** Whether the rows come from the published table. */
  published: boolean;
}

/** A single-document read before the row loads; the type is not known yet. */
export interface ContentBeforeReadHookContext extends HookContextBase {
  actor: { userId: string; roles: string[] } | null;
  spaceId: string;
  /** Whether the read targets the published table. */
  published: boolean;
}

/** A list-level read before its rows load. */
export interface ContentBeforeListHookContext extends HookContextBase {
  actor: { userId: string; roles: string[] } | null;
  spaceId: string;
  /** Whether the read targets the published table. */
  published: boolean;
}

/** What a list-level read asks for; `content:beforeList` sees it before any row loads. */
export interface ContentListRequest {
  /** `list` is a filtered page, `children` and `tree` walk the hierarchy. */
  kind: 'list' | 'children' | 'tree' | 'relation' | 'menu';
  /** Types the read is limited to; empty for any type. */
  typeIds: string[];
  /** `null` when the read spans locales or uses the space default. */
  locale: string | null;
  /** `children` and `tree`: the parent or root, `null` for the top level. */
  parentId?: string | null;
  /** `relation`: the query-configured field whose rows are listed. */
  fieldId?: string;
  /** `menu`: the menu name. */
  menu?: string;
}

/** One unpublish or delete of a subtree; its rows may span types. */
export interface ContentManyHookContext extends HookContextBase {
  actor: { userId: string; roles: string[] } | null;
  spaceId: string;
  /** The document the operation targeted, first among the rows. */
  rootId: string;
  /** See `ContentHookContext.services`. */
  services?: HookServices;
}

export interface ContentTypeUpdateHookContext extends HookContextBase {
  /** The type before the write. */
  previous: ContentTypeDefinition;
}

/** `contentType` is the type holding `field`, a block type for fields inside blocks. */
export interface FieldHookContext extends ContentHookContext {
  field: FieldDefinition;
}

export interface ContentWriteInput {
  id?: string;
  spaceId: string;
  typeId: string;
  locale: string;
  localizationId?: string;
  parentId?: string | null;
  title: string;
  slug: string;
  fields: Record<string, unknown>;
  position?: number;
  /** Expected version, for optimistic locking. */
  version?: number;
}

/** A space about to be created, or restored by an import with its export's id. */
export interface SpaceCreateInput {
  id?: string | undefined;
  name: string;
  machineName: string;
  url: string;
  defaultLocale?: string | undefined;
  locales?: string[] | undefined;
}

/** Where `request:served` counted a response; a plugin mode's name for its pages. */
export type RequestSurface = 'delivery' | 'management' | 'media' | (string & Record<never, never>);

/** A response after it was sent. */
export interface RequestServed {
  /** `delivery`: GraphQL and `/v1`; `management`: API-key reads; else a plugin mode. */
  surface: RequestSurface;
  /** `null` when the request names no space, e.g. admin media or an unknown host. */
  spaceId: string | null;
  status: number;
  /** Body bytes: `content-length`, else counted as the body streamed; 0 without a body. */
  bytes: number;
  /** Answered from the response cache or as `304 Not Modified`. */
  cached: boolean;
}

/** Hooks whose returned value replaces the payload; the rest observe or refuse by throwing. */
export const TRANSFORM_HOOKS = [
  'registry:contentTypes',
  'content:beforeValidate',
  'content:beforeCreate',
  'content:beforeUpdate',
  'content:afterRead',
  'content:afterReadMany',
  'content:afterList',
  'field:beforeValidate',
  'field:afterRead',
  'contentType:beforeCreate',
  'contentType:beforeUpdate',
  'asset:beforeUpload',
] as const satisfies readonly (keyof ManabloxHooks)[];

/** The hook surface: `[payload, context]` per hook name. */
export interface ManabloxHooks {
  // lifecycle
  'before:init': [undefined, HookContextBase];
  'after:init': [undefined, HookContextBase];
  'before:start': [undefined, HookContextBase];
  'after:start': [undefined, HookContextBase];
  'before:stop': [undefined, HookContextBase];

  // registry
  'registry:contentTypes': [ContentTypeDefinition[], HookContextBase];
  /** `synced` when another process changed the types and this one caught up. */
  /** `spaceId` names the one space whose types were reloaded (`null`: the global ones). */
  'registry:afterReload': [{ synced: boolean; spaceId?: string | null }, HookContextBase];

  // content write path
  'content:beforeValidate': [ContentWriteInput, ContentHookContext];
  'content:beforeCreate': [ContentWriteInput, ContentHookContext];
  'content:afterCreate': [ContentRecord, ContentHookContext];
  'content:beforeUpdate': [ContentWriteInput, ContentHookContext];
  'content:afterUpdate': [ContentRecord, ContentHookContext];
  'content:beforeDelete': [{ id: string }, ContentHookContext];
  /** `record` is the deleted row. */
  'content:afterDelete': [{ id: string; record: ContentRecord }, ContentHookContext];
  /** Once per delete, after the per-row hooks; the deleted rows. */
  'content:afterDeleteMany': [ContentRecord[], ContentManyHookContext];
  'content:beforePublish': [ContentRecord, ContentHookContext];
  'content:afterPublish': [ContentRecord, ContentHookContext];
  'content:beforeUnpublish': [{ id: string }, ContentHookContext];
  'content:afterUnpublish': [{ id: string }, ContentHookContext];
  /** Once per unpublish, after the per-row hooks; the rows as drafts now. */
  'content:afterUnpublishMany': [ContentRecord[], ContentManyHookContext];

  // content read path
  /** Before a single read by id, or by permalink in delivery; throw to refuse the read. */
  'content:beforeRead': [{ id: string }, ContentBeforeReadHookContext];
  /** Before a list, children, tree, relation or menu read; throw to refuse it. */
  'content:beforeList': [ContentListRequest, ContentBeforeListHookContext];
  /** Rows of the published projection carry `searchText: null`. */
  'content:afterRead': [ContentRecord | null, ContentHookContext];
  /** Once per page of reads, delivery included, after per-row `afterRead`; returns the rows kept. */
  'content:afterReadMany': [ContentRecord[], ContentReadManyHookContext];
  /** Once per list page, delivery included, after `content:afterReadMany`; returns the rows kept. */
  'content:afterList': [ContentRecord[], ContentReadManyHookContext];

  // field-level
  /** Per field, block fields too, before validation; `undefined` when absent. */
  'field:beforeValidate': [unknown, FieldHookContext];
  /** Per top-level field a read row holds, before `content:afterRead`. */
  'field:afterRead': [unknown, FieldHookContext];

  // content types
  /** Returns the input to validate and store. */
  'contentType:beforeCreate': [ContentTypeInput, HookContextBase];
  'contentType:afterCreate': [ContentTypeDefinition, HookContextBase];
  /** Returns the input to validate and store. */
  'contentType:beforeUpdate': [ContentTypeInput, ContentTypeUpdateHookContext];
  'contentType:afterUpdate': [ContentTypeDefinition, HookContextBase];
  /** The deleted type. */
  'contentType:afterDelete': [ContentTypeDefinition, HookContextBase];

  // assets
  /** Runs after the size and type checks; may rename the file or throw to reject it. */
  'asset:beforeUpload': [{ filename: string; mimeType: string; size: number }, HookContextBase];
  'asset:afterUpload': [{ id: string }, HookContextBase];
  /** After the record and files are gone; `size` includes variants. Handler errors are logged only. */
  'asset:afterDelete': [{ id: string; spaceIds: string[]; size: number }, HookContextBase];

  // spaces
  /** Before a space is created or imported; throw to refuse it. */
  'space:beforeCreate': [SpaceCreateInput, HookContextBase];
  /** Before a space's locales change; throw to refuse it. */
  'space:beforeLocalesChange': [
    { spaceId: string; locales: string[]; previous: string[] },
    HookContextBase,
  ];
  /** A space created or imported, once committed. Handler errors are logged only. */
  'space:afterCreate': [{ spaceId: string; url: string }, HookContextBase];
  /** A space's settings changed, once committed; `previousUrl` is its URL before. Logged only. */
  'space:afterUpdate': [{ spaceId: string; url: string; previousUrl: string }, HookContextBase];
  /** A space deleted, once committed. Handler errors are logged only. */
  'space:afterDelete': [{ spaceId: string; url: string }, HookContextBase];

  // API hosts
  /** An API host added to a space, once committed. Handler errors are logged only. */
  'apiHost:afterCreate': [{ id: string; spaceId: string; hostname: string }, HookContextBase];
  /** An API host removed from a space, once committed. Handler errors are logged only. */
  'apiHost:afterDelete': [{ id: string; spaceId: string; hostname: string }, HookContextBase];

  // menus
  /** Before a menu is created; throw to refuse it. */
  'menu:beforeCreate': [{ spaceId: string; name: string; machineName: string }, HookContextBase];
  'menu:afterWrite': [{ id: string; spaceId: string }, HookContextBase];
  'menu:afterDelete': [{ id: string; spaceId: string }, HookContextBase];

  // members
  /** Before a role is granted or changed, the owner of a new space too; throw to refuse it. */
  'member:beforeGrant': [
    { spaceId: string; userId: string; role: string; previous: string | null },
    HookContextBase,
  ];
  /**
   * A role granted or changed; `previous` is the prior role, if any. `mail: false` tells the
   * member in the admin only.
   */
  'member:afterGrant': [
    { spaceId: string; userId: string; role: string; previous: string | null; mail?: boolean },
    HookContextBase,
  ];

  // API keys
  /** Before an API key is issued; throw to refuse it. */
  'apiKey:beforeIssue': [
    {
      userId: string;
      name: string;
      spaceIds: string[] | null;
      permissions: string[] | null;
      expiresAt: Date | null;
    },
    HookContextBase,
  ];

  // redirects
  /** Before a redirect is created, by hand or by a publish that moved a permalink; throw to refuse it. */
  'redirect:beforeCreate': [
    { spaceId: string; locale: string | null; fromPath: string; source: RedirectSource },
    HookContextBase,
  ];

  // mail
  /** After a mail went out; `account` is an editor's own mailbox. Handler errors are logged only. */
  'mail:afterSend': [
    {
      spaceId: string | null;
      /** What sent it: `notification` from core, otherwise the sender's own name, e.g. `workflows`. */
      kind: string;
      /** Addresses it went to. */
      recipients: number;
      transport: 'instance' | 'account';
    },
    HookContextBase,
  ];

  // requests
  /** After a delivery, API-key, media or plugin mode response was sent. Handler errors are logged only. */
  'request:served': [RequestServed, HookContextBase];

  // cache
  'cache:purge': [{ tags: string[] }, HookContextBase];
}
