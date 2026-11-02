import type { PluginPermission } from '@manablox/core';

const group = 'Website';

/** Designs, their code and the site's domains; editors hold read, write and publish. */
export const websitePermissions: PluginPermission[] = [
  {
    key: 'website:read',
    label: 'See designs',
    description: 'Open the designer and preview links.',
    group,
    roles: ['editor'],
  },
  {
    key: 'website:write',
    label: 'Edit designs',
    description:
      'Change drafts of the theme, blocks, pages, layouts and menus, and restore versions into drafts.',
    group,
    roles: ['editor'],
  },
  {
    key: 'website:publish',
    label: 'Publish designs',
    description: 'Make design drafts live and reset designs.',
    group,
    roles: ['editor'],
  },
  {
    key: 'website:code',
    label: 'Edit custom CSS and head code',
    description: 'Head and body code runs as script on every page of the site.',
    group,
  },
  {
    key: 'website:domains',
    label: 'Manage domains',
    description: 'Which host names serve the designed site.',
    group,
  },
];
