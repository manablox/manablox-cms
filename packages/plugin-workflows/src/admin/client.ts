import { pluginClient } from '@manablox/admin-sdk';
// The router's types read the plugin's hook names.
import type {} from '../server/hooks';
import type { WorkflowsRouter } from '../server/rpc';

/** The workflows plugin's management router, `plugins.workflows`. */
export const workflowsApi = pluginClient<WorkflowsRouter>('workflows');
