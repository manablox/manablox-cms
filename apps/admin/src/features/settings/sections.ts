import type { FeatureState } from '@manablox/admin-sdk/lib/features';
import type { FeatureKey } from '@manablox/core';

/** Settings of the space being worked in, or of the whole instance. */
type SettingsScope = 'space' | 'instance';

/** A built-in section. */
export type CoreSettingsSection =
  | 'general'
  | 'members'
  | 'roles'
  | 'tags'
  | 'credentials'
  | 'apiHosts'
  | 'environments'
  | 'transfer'
  | 'backups'
  | 'usage'
  | 'spaces'
  | 'users'
  | 'security'
  | 'keys'
  | 'instanceUsage';

/** A built-in section, or a plugin's as `<plugin id>.<id>`. */
export type SettingsSection = CoreSettingsSection | `${string}.${string}`;

export interface SettingsSectionEntry {
  id: SettingsSection;
  label: string;
  icon: string;
  scope: SettingsScope;
  superadmin?: boolean;
  /** Needed in the current space. */
  permission?: string;
  /** Switched off, the section is removed (hidden) or shows the locked panel (locked). */
  feature?: FeatureKey;
}

export interface AvailableSection extends SettingsSectionEntry {
  locked: boolean;
}

/** In nav order. */
const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  { id: 'general', label: 'General', icon: 'settings', scope: 'space' },
  { id: 'members', label: 'Members', icon: 'users', scope: 'space' },
  { id: 'roles', label: 'Roles', icon: 'shield', scope: 'space', feature: 'customRoles' },
  { id: 'tags', label: 'Tags', icon: 'tag', scope: 'space', feature: 'tags' },
  { id: 'credentials', label: 'Credentials', icon: 'key', scope: 'space' },
  { id: 'apiHosts', label: 'API hosts', icon: 'globe', scope: 'space', feature: 'customDomains' },
  {
    id: 'environments',
    label: 'Environments',
    icon: 'layers',
    scope: 'space',
    feature: 'environments',
  },
  {
    id: 'transfer',
    label: 'Export and transfer',
    icon: 'archive',
    scope: 'space',
    permission: 'space:export',
  },
  {
    id: 'backups',
    label: 'Backups',
    icon: 'database',
    scope: 'space',
    permission: 'space:export',
    feature: 'snapshots',
  },
  { id: 'usage', label: 'Usage', icon: 'activity', scope: 'space', permission: 'space:write' },
  { id: 'spaces', label: 'Spaces', icon: 'globe', scope: 'instance' },
  { id: 'users', label: 'Users', icon: 'users', scope: 'instance', superadmin: true },
  { id: 'security', label: 'Security', icon: 'shield', scope: 'instance', superadmin: true },
  { id: 'keys', label: 'API keys', icon: 'key', scope: 'instance' },
  {
    id: 'instanceUsage',
    label: 'Usage',
    icon: 'activity',
    scope: 'instance',
    superadmin: true,
  },
];

/**
 * What the viewer may open; space sections need a space, and one still importing shows only
 * General. A hidden feature drops its section; a locked one is kept and marked.
 */
export function availableSections(context: {
  isSuperadmin: boolean;
  hasSpace: boolean;
  importing: boolean;
  can: (permission: string) => boolean;
  /** Everything is on without it. */
  feature?: (key: FeatureKey) => FeatureState;
  /** Plugin sections, after the built-in ones of their scope. */
  extra?: readonly SettingsSectionEntry[];
}): AvailableSection[] {
  const extra = context.extra ?? [];
  const inScope = (scope: SettingsScope) => [
    ...SETTINGS_SECTIONS.filter((entry) => entry.scope === scope),
    ...extra.filter((entry) => entry.scope === scope),
  ];
  return [...inScope('space'), ...inScope('instance')].flatMap((entry) => {
    if (entry.superadmin && !context.isSuperadmin) return [];
    if (entry.scope === 'space') {
      if (!context.hasSpace || (context.importing && entry.id !== 'general')) return [];
      if (entry.permission && !context.can(entry.permission)) return [];
    }
    const state = entry.feature && context.feature ? context.feature(entry.feature) : null;
    if (state?.hidden) return [];
    return [{ ...entry, locked: Boolean(state?.locked) }];
  });
}

/** `?tab=` as an open section; General, or Spaces without a space, when absent or not allowed. */
export function resolveSection(
  asked: unknown,
  available: readonly AvailableSection[],
): AvailableSection {
  const fallback =
    available.find((entry) => entry.id === 'general') ??
    available.find((entry) => entry.id === 'spaces');
  return available.find((entry) => entry.id === asked) ?? (fallback as AvailableSection);
}

export const settingsTo = (section: SettingsSection): string => `/settings?tab=${section}`;
