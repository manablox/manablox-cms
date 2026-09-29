/** Audit log vocabulary: actors, targets, actions, entries. Browser-safe. */

/** Who did something, as core records it. */
export type CoreAuditActorKind = 'user' | 'apikey' | 'system' | 'control';

/** A core kind, or one a plugin declares in `audit.actorKinds` (its id, or `<id>.<name>`). */
export type AuditActorKind = CoreAuditActorKind | (string & {});

/** Every core actor kind, for schemas that enumerate them; plugins add theirs. */
export const AUDIT_ACTOR_KINDS = [
  'user',
  'apikey',
  'system',
  'control',
] as const satisfies readonly CoreAuditActorKind[];

export interface AuditActor {
  kind: AuditActorKind;
  /** The user id, a plugin's own id (e.g. of a run), or `null` for the system itself. */
  id: string | null;
  /** Display name, snapshotted at write time. */
  label: string;
  /** Context: the API key, the run, the request, the client. */
  detail?: Record<string, unknown> | undefined;
}

export const AUDIT_ACTOR_KIND_LABELS: Record<CoreAuditActorKind, string> = {
  user: 'User',
  apikey: 'API key',
  system: 'System',
  control: 'Control API',
};

export type CoreAuditTargetKind =
  | 'content'
  | 'contentType'
  | 'space'
  | 'member'
  | 'user'
  | 'invitation'
  | 'instance'
  | 'ssoProvider'
  | 'apiKey'
  | 'menu'
  | 'role'
  | 'credential'
  | 'asset'
  | 'tag'
  | 'session'
  | 'redirect'
  | 'apiHost'
  | 'control'
  | 'spaceGroup'
  | 'environment'
  | 'audit';

/** A plugin's target kind, `<pluginId>.<entity>`. */
export type PluginAuditTargetKind = `${string}.${string}`;

export type AuditTargetKind = CoreAuditTargetKind | PluginAuditTargetKind;

/** Every target kind, for schemas that enumerate them. */
export const AUDIT_TARGET_KINDS = [
  'content',
  'contentType',
  'space',
  'member',
  'user',
  'invitation',
  'instance',
  'ssoProvider',
  'apiKey',
  'menu',
  'role',
  'credential',
  'asset',
  'tag',
  'session',
  'redirect',
  'apiHost',
  'control',
  'spaceGroup',
  'environment',
  'audit',
] as const satisfies readonly CoreAuditTargetKind[];

export const AUDIT_TARGET_KIND_LABELS: Record<CoreAuditTargetKind, string> &
  Partial<Record<PluginAuditTargetKind, string>> = {
  content: 'Document',
  contentType: 'Content type',
  space: 'Space',
  member: 'Member',
  user: 'Account',
  invitation: 'Invitation',
  instance: 'Instance',
  ssoProvider: 'SSO provider',
  apiKey: 'API key',
  menu: 'Menu',
  role: 'Role',
  credential: 'Credential',
  asset: 'Asset',
  tag: 'Tag',
  session: 'Session',
  redirect: 'Redirect',
  apiHost: 'API host',
  control: 'Control setting',
  spaceGroup: 'Space group',
  environment: 'Environment',
  audit: 'Audit log',
};

/** Every recorded action, as `<target>.<verb>`. */
export const AUDIT_ACTIONS = [
  'content.create',
  'content.duplicate',
  'content.update',
  'content.move',
  'content.delete',
  'content.publish',
  'content.unpublish',
  'content.schedule',
  'content.restore',
  'content.translate',
  'content.requestApproval',
  'content.approve',
  'content.reject',
  'content.withdrawApproval',
  'contentType.create',
  'contentType.update',
  'contentType.delete',
  'space.create',
  'space.update',
  'space.delete',
  'space.setHome',
  'space.setAssetSettings',
  'space.export',
  'space.import',
  'space.snapshot',
  'space.restore',
  'member.grant',
  'member.revoke',
  'user.create',
  'user.update',
  'user.setRole',
  'user.setPassword',
  'user.changePassword',
  'user.setNotificationPreferences',
  'user.ban',
  'user.unban',
  'user.delete',
  'user.revokeSessions',
  'user.promote',
  'user.requestPasswordReset',
  'user.resetPassword',
  'user.requestEmailChange',
  'user.verifyEmail',
  'user.enableTwoFactor',
  'user.disableTwoFactor',
  'user.regenerateBackupCodes',
  'user.linkSso',
  'invitation.create',
  'invitation.resend',
  'invitation.revoke',
  'invitation.accept',
  'instance.updateSettings',
  'ssoProvider.create',
  'ssoProvider.update',
  'ssoProvider.delete',
  'apiKey.issue',
  'apiKey.revoke',
  'apiKey.prune',
  'menu.create',
  'menu.update',
  'menu.delete',
  'menu.setItems',
  'role.create',
  'role.update',
  'role.delete',
  'role.grantContentType',
  'credential.create',
  'credential.update',
  'credential.delete',
  'asset.upload',
  'asset.update',
  'asset.schedule',
  'asset.setImageEdits',
  'asset.setSpaces',
  'asset.removeFromSpace',
  'asset.delete',
  'tag.create',
  'tag.update',
  'tag.merge',
  'tag.delete',
  'session.signIn',
  'session.signInFailed',
  'apiKey.rejected',
  'redirect.create',
  'redirect.update',
  'redirect.delete',
  'apiHost.create',
  'apiHost.delete',
  'control.set',
  'control.replace',
  'control.delete',
  'spaceGroup.create',
  'spaceGroup.update',
  'spaceGroup.delete',
  'spaceGroup.assignSpaces',
  'environment.create',
  'environment.promote',
  'environment.delete',
  'usage.external',
  'audit.pruned',
] as const;

export type CoreAuditAction = (typeof AUDIT_ACTIONS)[number];

/** A plugin's action, `<pluginId>.<entity>.<verb>`. */
export type PluginAuditAction = `${string}.${string}.${string}`;

export type AuditAction = CoreAuditAction | PluginAuditAction;

export const AUDIT_ACTION_LABELS: Record<CoreAuditAction, string> &
  Partial<Record<PluginAuditAction, string>> = {
  'content.create': 'Created a document',
  'content.duplicate': 'Duplicated a document',
  'content.update': 'Edited a document',
  'content.move': 'Moved a document',
  'content.delete': 'Deleted a document',
  'content.publish': 'Published a document',
  'content.unpublish': 'Unpublished a document',
  'content.schedule': 'Scheduled a document',
  'content.restore': 'Restored a version',
  'content.translate': 'Started a translation',
  'content.requestApproval': 'Asked for a document to be approved',
  'content.approve': 'Approved a document',
  'content.reject': 'Sent a document back',
  'content.withdrawApproval': 'Withdrew a request for approval',
  'contentType.create': 'Created a content type',
  'contentType.update': 'Edited a content type',
  'contentType.delete': 'Deleted a content type',
  'space.create': 'Created a space',
  'space.update': 'Changed space settings',
  'space.delete': 'Deleted a space',
  'space.setHome': 'Set the home page',
  'space.setAssetSettings': 'Changed upload limits',
  'space.export': 'Exported the space',
  'space.import': 'Imported a space',
  'space.snapshot': 'Took a snapshot',
  'space.restore': 'Restored a snapshot',
  'member.grant': 'Added or changed a member',
  'member.revoke': 'Removed a member',
  'user.create': 'Created an account',
  'user.update': 'Edited an account',
  'user.setRole': 'Changed an instance role',
  'user.setPassword': 'Reset a password',
  'user.changePassword': 'Changed their own password',
  'user.setNotificationPreferences': 'Changed notification preferences',
  'user.ban': 'Banned an account',
  'user.unban': 'Unbanned an account',
  'user.delete': 'Deleted an account',
  'user.revokeSessions': 'Signed an account out everywhere',
  'user.promote': 'Promoted the first account',
  'user.requestPasswordReset': 'Sent or created a password reset link',
  'user.resetPassword': 'Set a new password with a reset link',
  'user.requestEmailChange': 'Asked to change an email address',
  'user.verifyEmail': 'Confirmed an email address',
  'user.enableTwoFactor': 'Turned on two-factor authentication',
  'user.disableTwoFactor': 'Turned off two-factor authentication',
  'user.regenerateBackupCodes': 'Created new two-factor backup codes',
  'user.linkSso': 'Linked a single sign-on identity',
  'invitation.create': 'Invited someone',
  'invitation.resend': 'Sent an invitation again',
  'invitation.revoke': 'Revoked an invitation',
  'invitation.accept': 'Accepted an invitation',
  'instance.updateSettings': 'Changed instance settings',
  'ssoProvider.create': 'Added an SSO provider',
  'ssoProvider.update': 'Edited an SSO provider',
  'ssoProvider.delete': 'Removed an SSO provider',
  'apiKey.issue': 'Issued an API key',
  'apiKey.revoke': 'Revoked an API key',
  'apiKey.prune': 'Removed expired API keys',
  'menu.create': 'Created a menu',
  'menu.update': 'Edited a menu',
  'menu.delete': 'Deleted a menu',
  'menu.setItems': 'Changed menu entries',
  'role.create': 'Created a role',
  'role.update': 'Edited a role',
  'role.delete': 'Deleted a role',
  'role.grantContentType': 'Granted a new type to a role',
  'credential.create': 'Added a credential',
  'credential.update': 'Edited a credential',
  'credential.delete': 'Removed a credential',
  'asset.upload': 'Uploaded an asset',
  'asset.update': 'Edited an asset',
  'asset.schedule': 'Scheduled an asset',
  'asset.setImageEdits': 'Cropped or refocused an image',
  'asset.setSpaces': 'Changed which spaces an asset is in',
  'asset.removeFromSpace': 'Removed a shared asset from this space',
  'asset.delete': 'Deleted an asset',
  'tag.create': 'Created a tag',
  'tag.update': 'Renamed a tag',
  'tag.merge': 'Merged two tags',
  'tag.delete': 'Deleted a tag',
  'session.signIn': 'Signed in',
  'session.signInFailed': 'Failed to sign in',
  'apiKey.rejected': 'Presented an API key that was refused',
  'redirect.create': 'Added a redirect',
  'redirect.update': 'Edited a redirect',
  'redirect.delete': 'Removed a redirect',
  'apiHost.create': 'Added an API host',
  'apiHost.delete': 'Removed an API host',
  'control.set': 'Set control values',
  'control.replace': 'Replaced the control values of a scope',
  'control.delete': 'Removed a control value',
  'spaceGroup.create': 'Created a space group',
  'spaceGroup.update': 'Edited a space group',
  'spaceGroup.delete': 'Deleted a space group',
  'spaceGroup.assignSpaces': 'Moved spaces into a space group',
  'environment.create': 'Created an environment',
  'environment.promote': 'Promoted an environment to production',
  'environment.delete': 'Deleted an environment',
  'usage.external': 'Reported external usage',
  'audit.pruned': 'Removed audit entries past the retention window',
};

/** The filter vocabulary for the admin: every id with its label, a plugin target kind's key. */
export interface AuditCatalog {
  actions: Array<{ id: AuditAction; label: string }>;
  /** Core kinds labelled, plugin kinds labelled by their key. */
  actorKinds: Array<{ id: AuditActorKind; label: string }>;
  targetKinds: Array<{ id: AuditTargetKind; label: string }>;
}

/** A core action, or any verb on a registered plugin entity. */
export function isAuditAction(value: string): value is AuditAction {
  if ((AUDIT_ACTIONS as readonly string[]).includes(value)) return true;
  const dot = value.lastIndexOf('.');
  return dot > 0 && dot < value.length - 1 && pluginEntities.has(value.slice(0, dot));
}

const pluginAudit = new Map<string, readonly PluginAuditTargetKind[]>();
const pluginEntities = new Set<string>();
const pluginActors = new Map<string, readonly string[]>();

/** Replaces one plugin's audit entities and actor kinds; checked by `resolveConfig`. */
export function setPluginAudit(
  id: string,
  entities: readonly PluginAuditTargetKind[],
  actorKinds: readonly string[] = [],
): void {
  if (entities.length) pluginAudit.set(id, entities);
  else pluginAudit.delete(id);
  if (actorKinds.length) pluginActors.set(id, actorKinds);
  else pluginActors.delete(id);
  pluginEntities.clear();
  for (const list of pluginAudit.values()) for (const key of list) pluginEntities.add(key);
}

/** Every registered plugin audit entity. */
export function pluginAuditEntities(): PluginAuditTargetKind[] {
  return [...pluginAudit.values()].flat();
}

/** Every actor kind a registered plugin declared. */
export function pluginAuditActorKinds(): string[] {
  return [...pluginActors.values()].flat();
}

/** A core actor kind or a registered plugin's. */
export function isAuditActorKind(value: string): value is AuditActorKind {
  return (
    (AUDIT_ACTOR_KINDS as readonly string[]).includes(value) ||
    pluginAuditActorKinds().includes(value)
  );
}

/** One field that changed: its path (`title`, `fields.body`) and both values. */
export interface AuditChange {
  path: string;
  from: unknown;
  to: unknown;
}

/** An entry as read back. */
export interface AuditEntry {
  id: string;
  /** Strictly increasing; the order the hash chain runs in. */
  seq: number;
  at: Date;
  spaceId: string | null;
  actorKind: AuditActorKind;
  actorId: string | null;
  actorLabel: string;
  actorDetail: Record<string, unknown> | null;
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId: string | null;
  targetLabel: string | null;
  changes: AuditChange[];
  /** Non-field facts: a version, a run's status. */
  meta: Record<string, unknown> | null;
  prevHash: string | null;
  hash: string;
}

export type AuditSortField = 'at' | 'action' | 'actorLabel' | 'targetKind' | 'targetLabel';

/** Serialised values above this are replaced by a size note. */
export const AUDIT_VALUE_LIMIT = 16 * 1024;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Deterministic sorted-key JSON, for hashing and equality. Dates become ISO strings. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Replaces an oversized value with a size note. */
function boundValue(value: unknown): unknown {
  const serialised = canonicalJson(value);
  if (serialised.length <= AUDIT_VALUE_LIMIT) return value;
  return { $truncated: true, length: serialised.length };
}

export interface DiffOptions {
  /** Extra keys to skip. */
  ignore?: readonly string[] | undefined;
  /** Keys compared one level down, e.g. `fields` reports `fields.body`. */
  expand?: readonly string[] | undefined;
}

const DEFAULT_IGNORE = ['updatedAt', 'createdAt', 'version', 'search', 'searchText'];

/** Key-by-key changes between two records. */
export function diffRecords(
  beforeRecord: object | null | undefined,
  afterRecord: object | null | undefined,
  options: DiffOptions = {},
): AuditChange[] {
  const before = beforeRecord as Record<string, unknown> | null | undefined;
  const after = afterRecord as Record<string, unknown> | null | undefined;
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const expand = new Set(options.expand ?? []);
  const changes: AuditChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of [...keys].sort()) {
    if (ignore.has(key)) continue;
    const from = before?.[key];
    const to = after?.[key];
    if (expand.has(key) && (isPlainObject(from) || isPlainObject(to))) {
      const inner = new Set([
        ...Object.keys(isPlainObject(from) ? from : {}),
        ...Object.keys(isPlainObject(to) ? to : {}),
      ]);
      for (const name of [...inner].sort()) {
        const a = isPlainObject(from) ? from[name] : undefined;
        const b = isPlainObject(to) ? to[name] : undefined;
        if (canonicalJson(a) !== canonicalJson(b)) {
          changes.push({ path: `${key}.${name}`, from: boundValue(a), to: boundValue(b) });
        }
      }
      continue;
    }
    if (canonicalJson(from) !== canonicalJson(to)) {
      changes.push({ path: key, from: boundValue(from), to: boundValue(to) });
    }
  }
  return changes;
}

/** A create or delete as changes from or to nothing. */
export function snapshotChanges(
  record: object,
  direction: 'created' | 'deleted',
  options: DiffOptions = {},
): AuditChange[] {
  return direction === 'created'
    ? diffRecords(null, record, options)
    : diffRecords(record, null, options);
}

/** Everything the hash covers. */
export interface AuditHashInput {
  at: Date;
  spaceId: string | null;
  actorKind: AuditActorKind;
  actorId: string | null;
  actorLabel: string;
  actorDetail: Record<string, unknown> | null;
  action: string;
  targetKind: string;
  targetId: string | null;
  targetLabel: string | null;
  changes: AuditChange[];
  meta: Record<string, unknown> | null;
  prevHash: string | null;
}

/** The hashed bytes of an entry. Must stay stable, or existing chains stop verifying. */
export function auditHashPayload(input: AuditHashInput): string {
  return canonicalJson({
    at: input.at.toISOString(),
    spaceId: input.spaceId,
    actorKind: input.actorKind,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    actorDetail: input.actorDetail,
    action: input.action,
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    changes: input.changes,
    meta: input.meta,
    prevHash: input.prevHash,
  });
}
