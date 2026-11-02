import type { PluginPermission } from '@manablox/core';

const group = 'AI';

/** Seeing, using and configuring AI; editors and authors see and use it. */
export const aiPermissions: PluginPermission[] = [
  {
    key: 'ai:read',
    label: 'See the AI settings',
    description: 'Which providers are set up, never their keys.',
    group,
    roles: ['editor', 'author'],
  },
  {
    key: 'ai:use',
    label: 'Generate content',
    description: 'Use the magic wand on a field, and generate a whole document.',
    group,
    roles: ['editor', 'author'],
  },
  {
    key: 'ai:configure',
    label: 'Configure providers',
    description: 'Add keys, choose models and edit the system prompts every generation runs under.',
    group,
  },
];
