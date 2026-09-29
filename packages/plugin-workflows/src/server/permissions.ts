import type { PluginPermission } from '@manablox/core';

const group = 'Workflows';

/** Seeing workflows and their runs, and editing them; editors see them. */
export const workflowPermissions: PluginPermission[] = [
  {
    key: 'workflows:read',
    label: 'See workflows and their runs',
    group,
    roles: ['editor'],
  },
  {
    key: 'workflows:write',
    label: 'Create, edit and switch workflows on or off',
    description: 'A workflow can send mail and call other systems on behalf of the space.',
    group,
  },
];
