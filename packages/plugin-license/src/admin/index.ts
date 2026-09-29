import { defineAdminPlugin } from '@manablox/admin-plugin';
import './style.css';

/** Where the keys are. */
const SETTINGS = '/settings?tab=license.licenses';

/** The key actions, by verb. */
const ACTIONS: Record<string, [label: string, verb: string]> = {
  'license.key.add': ['Added a license key', 'Added'],
  'license.key.remove': ['Removed a license key', 'Removed'],
  'license.key.activate': ['Activated a license key here', 'Activated'],
  'license.key.deactivate': ['Deactivated a license key', 'Deactivated'],
  'license.key.freeSeat': ["Freed another instance's seat of a license key", 'Freed a seat of'],
};
const actions = Object.fromEntries(Object.entries(ACTIONS).map(([name, [label]]) => [name, label]));
const verbs = Object.fromEntries(Object.entries(ACTIONS).map(([name, [, verb]]) => [name, verb]));

/** Settings → Licenses: the instance's keys, for superadmins. */
export default defineAdminPlugin({
  name: 'license',
  settingsSections: [
    {
      id: 'licenses',
      label: 'Licenses',
      icon: 'key',
      scope: 'instance',
      superadmin: true,
      component: () => import('./components/LicenseSettings.vue'),
    },
  ],
  audit: {
    entities: { 'license.key': { label: 'License key', route: () => SETTINGS } },
    actions,
    verbs,
  },
  features: { 'plugins.license': 'License keys' },
});
