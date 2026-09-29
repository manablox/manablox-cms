import type { FeatureKey } from '@manablox/core';
import { shallowRef } from 'vue';
import type { Me } from './api-types';

/** A feature as the admin shows it. */
export interface FeatureState {
  enabled: boolean;
  /** Off and removed from the admin. */
  hidden: boolean;
  /** Off and shown with a lock. */
  locked: boolean;
  message: string | null;
  /** The feature's link, else the upgrade link. */
  link: string | null;
}

export const FEATURE_ON: FeatureState = {
  enabled: true,
  hidden: false,
  locked: false,
  message: null,
  link: null,
};

/** A feature in a space (the instance with `null`); the instance entry stands in for an unlisted space. */
export function featureState(me: Me | null, key: FeatureKey, spaceId: string | null): FeatureState {
  const controls = me?.controls;
  if (!controls) return FEATURE_ON;
  const space = spaceId ? controls.spaces[spaceId] : undefined;
  const off = (space ?? controls).features[key];
  if (!off) return FEATURE_ON;
  const hidden = off.presentation === 'hidden';
  return {
    enabled: false,
    hidden,
    locked: !hidden,
    message: off.message ?? null,
    link: off.link ?? controls.links.upgrade ?? null,
  };
}

const LABELS: Partial<Record<FeatureKey, string>> = {
  customRoles: 'Custom roles',
  approvals: 'Approvals',
  scheduledPublishing: 'Scheduled publishing',
  versionRestore: 'Restoring versions',
  visualEditor: 'The visual editor',
  databags: 'Databags',
  menus: 'Menus',
  tags: 'Tags',
  apiKeys: 'API keys',
  graphqlDelivery: 'The GraphQL delivery API',
  restDelivery: 'The REST delivery API',
  transferExport: 'Space export',
  transferImport: 'Space import',
  customDomains: 'Custom domains',
  twoFactor: 'Two-factor authentication',
  sso: 'Single sign-on',
  snapshots: 'Snapshots',
  environments: 'Environments',
  spaceCreate: 'Creating spaces',
};

/** Plugin flags and features by key, from the server's plugin catalogue. */
const PLUGIN_LABELS: Record<string, string> = {};

/** Adds the flags and declared features of the loaded plugins (`instance.plugins`). */
export function registerPluginFeatures(
  plugins: ReadonlyArray<{
    name: string;
    feature: string;
    controls: ReadonlyArray<{ key: string; kind: string; label: string }>;
  }>,
): void {
  for (const plugin of plugins) {
    PLUGIN_LABELS[plugin.feature] = `The ${plugin.name} plugin`;
    for (const control of plugin.controls) {
      if (control.kind === 'feature') {
        PLUGIN_LABELS[control.key.slice('features.'.length)] = control.label;
      }
    }
  }
}

/** Names of features an admin plugin brings, by key. */
export function registerFeatureLabels(labels: Record<string, string>): void {
  Object.assign(PLUGIN_LABELS, labels);
}

/** The feature's name for a sentence; unregistered plugins by id. */
export function featureLabel(key: FeatureKey): string {
  const plugin = PLUGIN_LABELS[key];
  if (plugin) return plugin;
  if (key.startsWith('plugins.')) return `The ${key.slice('plugins.'.length)} plugin`;
  return LABELS[key] ?? key;
}

export interface LockedNotice {
  feature: FeatureKey;
  message: string | null;
  link: string | null;
}

/** The feature a refused write names, shown by `<FeatureLockedDialog />` at the root. */
export const lockedNotice = shallowRef<LockedNotice | null>(null);

export function showLocked(notice: LockedNotice): void {
  lockedNotice.value = notice;
}
