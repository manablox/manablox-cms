import { usePluginApi } from '@manablox/admin-sdk';
import type { WorkflowsAdminApi } from '@manablox/plugin-workflows/admin-api';

/** The workflows plugin's api; undefined when that plugin is not loaded. */
export const useWorkflowsApi = (): WorkflowsAdminApi | undefined =>
  usePluginApi<WorkflowsAdminApi>('workflows');
