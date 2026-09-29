import type { SortState } from '@manablox/admin-sdk/composables/useSort';
import type { AuditEntry } from '@manablox/admin-sdk/lib/api-types';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_KIND_LABELS,
  AUDIT_TARGET_KIND_LABELS,
  type AuditAction,
  type AuditActorKind,
  type AuditSortField,
  type AuditTargetKind,
  type CoreAuditActorKind,
} from '@manablox/core';
import {
  pluginActionLabel,
  pluginActor,
  pluginEntityLabel,
  pluginEntityRoute,
  pluginOutcome,
  pluginVerb,
} from '~/lib/plugins/registry';

export type { AuditEntry };

/** The filter bar's state; empty means everything. */
export interface AuditFilterForm {
  search: string;
  actorKind: AuditActorKind | '';
  action: AuditAction | '';
  targetKind: AuditTargetKind | '';
  from: string;
  to: string;
}

export type AuditSortState = SortState<AuditSortField>;

export const PAGE_SIZE = 50;

export function emptyFilter(): AuditFilterForm {
  return { search: '', actorKind: '', action: '', targetKind: '', from: '', to: '' };
}

export function hasFilter(form: AuditFilterForm): boolean {
  return Object.values(form).some((value) => value !== '');
}

/** The form as the procedure's filter: blanks dropped, dates parsed. */
export function toFilterInput(form: AuditFilterForm) {
  return {
    ...(form.search.trim() ? { search: form.search.trim() } : {}),
    ...(form.actorKind ? { actorKind: form.actorKind } : {}),
    ...(form.action ? { actions: [form.action] } : {}),
    ...(form.targetKind ? { targetKind: form.targetKind } : {}),
    ...(form.from ? { from: new Date(form.from) } : {}),
    ...(form.to ? { to: new Date(form.to) } : {}),
  };
}

/** Plugin actor kinds get the fallback. */
const ACTOR_ICONS: Record<CoreAuditActorKind, string> = {
  user: 'user',
  apikey: 'key',
  system: 'settings',
  control: 'shield',
};

const ACTOR_TONES: Record<CoreAuditActorKind, string> = {
  user: 'mb-tile-clay',
  apikey: 'mb-tile-sand',
  system: 'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300',
  control: 'mb-tile-ochre',
};

const isCoreActor = (kind: AuditActorKind): kind is CoreAuditActorKind => kind in ACTOR_ICONS;

export const actorIcon = (kind: AuditActorKind): string =>
  isCoreActor(kind) ? ACTOR_ICONS[kind] : (pluginActor(kind)?.icon ?? 'puzzle');

export const actorTone = (kind: AuditActorKind): string =>
  isCoreActor(kind) ? ACTOR_TONES[kind] : ACTOR_TONES.system;

/** A plugin actor kind shows as its plugin names it, else as its key. */
export const actorKindLabel = (kind: AuditActorKind): string =>
  isCoreActor(kind) ? AUDIT_ACTOR_KIND_LABELS[kind] : (pluginActor(kind)?.label ?? kind);

/** Plugin kinds and actions take their labels from the plugin's admin bundle, else the key. */
export const targetKindLabel = (kind: AuditTargetKind): string =>
  AUDIT_TARGET_KIND_LABELS[kind] ?? pluginEntityLabel(kind) ?? kind;
export const actionLabel = (action: string): string =>
  AUDIT_ACTION_LABELS[action as keyof typeof AUDIT_ACTION_LABELS] ??
  pluginActionLabel(action) ??
  action;

/** An action's verb, its last part: `create` of `content.create` or `acme.note.create`. */
const verbOf = (action: string): string => action.split('.').at(-1) ?? '';

/** A tone by the action's verb. */
export function actionTone(action: string): 'ok' | 'danger' | 'warn' | 'neutral' {
  const verb = verbOf(action);
  if (/^(create|upload|issue|publish|grant|signIn|promote)/.test(verb)) return 'ok';
  if (/^(delete|revoke|ban|prune|unpublish)/.test(verb)) return 'danger';
  if (/^(setPassword|resetPassword|requestPasswordReset|revokeSessions|finish)/.test(verb))
    return 'warn';
  return 'neutral';
}

/** The target's admin route, if it can be opened. */
export function targetRoute(entry: AuditEntry): string | null {
  if (entry.action.endsWith('.delete')) return null;
  const plugin = pluginEntityRoute(entry.targetKind, entry.targetId, entry.meta ?? null);
  if (plugin !== undefined) return plugin;
  if (!entry.targetId) return null;
  switch (entry.targetKind) {
    case 'content':
      return `/content/${entry.targetId}`;
    case 'contentType':
      return `/types/${entry.targetId}`;
    case 'menu':
      return `/menus/${entry.targetId}`;
    case 'redirect':
      return '/redirects';
    case 'apiHost':
      return '/settings?tab=apiHosts';
    case 'credential':
      return '/settings?tab=credentials';
    default:
      return null;
  }
}

/** The server's placeholder for a value too large to store. */
function truncatedLength(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('$truncated' in value)) return null;
  const length = (value as { length?: unknown }).length;
  return typeof length === 'number' ? length : 0;
}

/** Strings as is, else pretty JSON. */
export function pretty(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const truncated = truncatedLength(value);
  if (truncated !== null) return `Too large to keep: ${truncated} characters`;
  return JSON.stringify(value, null, 2);
}

/** The verb for a row's badge. */
const VERBS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  move: 'Moved',
  delete: 'Deleted',
  publish: 'Published',
  unpublish: 'Unpublished',
  restore: 'Restored',
  translate: 'Translated',
  setHome: 'Home page',
  setAssetSettings: 'Upload limits',
  export: 'Exported',
  import: 'Imported',
  grant: 'Granted',
  revoke: 'Revoked',
  setRole: 'Role',
  setPassword: 'Password',
  requestPasswordReset: 'Reset link',
  resetPassword: 'Password reset',
  ban: 'Banned',
  unban: 'Unbanned',
  revokeSessions: 'Signed out',
  promote: 'Promoted',
  issue: 'Issued',
  prune: 'Pruned',
  setItems: 'Entries',
  grantContentType: 'Granted type',
  setEnabled: 'Switched',
  runNow: 'Test-ran',
  start: 'Started',
  finish: 'Run finished',
  upload: 'Uploaded',
  setImageEdits: 'Cropped',
  signIn: 'Signed in',
  save: 'Saved',
  discard: 'Discarded',
  share: 'Shared',
};

export function verb(action: string): string {
  return pluginVerb(action) ?? VERBS[verbOf(action)] ?? actionLabel(action);
}

/** One word beside the verb: a run's outcome, a switch's new state. */
export function outcome(entry: AuditEntry): string | null {
  const plugin = pluginOutcome(entry.action, entry.meta ?? null, entry.changes);
  if (plugin !== undefined) return plugin;
  if (entry.action === 'member.grant') {
    const change = entry.changes.find((c) => c.path === 'role');
    return typeof change?.to === 'string' ? change.to : null;
  }
  return null;
}

/** Changed field names, or just a count for creations and deletions. */
export function changedFields(entry: AuditEntry): { chips: string[]; note: string | null } {
  const { changes } = entry;
  if (!changes.length) return { chips: [], note: null };
  const created = changes.every((c) => c.from === undefined);
  const deleted = changes.every((c) => c.to === undefined);
  if (created || deleted) {
    return {
      chips: [],
      note: `${changes.length} ${changes.length === 1 ? 'field' : 'fields'} ${created ? 'set' : 'removed'}`,
    };
  }
  const names = changes.map((c) => c.path.replace(/^fields\./, ''));
  return { chips: names.slice(0, 6), note: names.length > 6 ? `+${names.length - 6} more` : null };
}

/** Sortable columns; the event column sorts by action. */
export const SORT_FIELDS: Array<{ value: AuditSortField; label: string }> = [
  { value: 'at', label: 'When' },
  { value: 'actorLabel', label: 'Who' },
  { value: 'action', label: 'What happened' },
];
