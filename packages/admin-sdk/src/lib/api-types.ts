import type { ManabloxRouter } from '@manablox/api-rpc';
import type { RouterClient } from '@orpc/server';

/** Domain types inferred from the management router; do not hand-write them. */
type Client = RouterClient<ManabloxRouter>;

/** The resolved output of one procedure: `Output<'spaces', 'list'>`. */
type Output<K extends keyof Client, P extends keyof Client[K]> = Client[K][P] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;

export type Space = Output<'spaces', 'list'>[number];
export type ContentTypeSummary = Output<'contentTypes', 'list'>[number];
export type FieldDefinition = ContentTypeSummary['fields'][number];
export type FieldTypeMeta = Output<'contentTypes', 'fieldTypes'>[number];
export type Me = NonNullable<Output<'users', 'me'>>;
export type UsageOverview = Output<'usage', 'space'>;
export type SnapshotList = Output<'snapshots', 'list'>;
export type Role = Output<'roles', 'list'>[number];
export type Asset = Output<'assets', 'list'>['items'][number];
export type TagWithCounts = Output<'tags', 'listWithCounts'>[number];
export type MenuDetail = Output<'menus', 'get'>;
export type ContentDocument = NonNullable<Output<'content', 'get'>>;
export type ContentListItem = Output<'content', 'list'>['items'][number];
export type ContentTreeSearch = Output<'content', 'treeSearch'>;
export type ContentTreeChild = Output<'content', 'treeChildren'>['items'][number];
export type AuditEntry = Output<'audit', 'list'>['items'][number];
export type AuditVerification = Output<'audit', 'verify'>;
export type Notification = Output<'notifications', 'list'>['items'][number];
export type NotificationPreferences = Output<'notifications', 'preferences'>;
