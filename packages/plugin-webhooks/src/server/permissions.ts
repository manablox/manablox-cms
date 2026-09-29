import type { PluginPermission } from '@manablox/core';

const group = 'Webhooks';

/** Seeing webhooks and their calls, and editing them; editors see them. */
export const webhookPermissions: PluginPermission[] = [
  { key: 'webhooks:read', label: 'See webhooks', group, roles: ['editor'] },
  { key: 'webhooks:write', label: 'Create and edit webhooks', group },
];
