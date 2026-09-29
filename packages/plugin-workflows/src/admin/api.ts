import { defineAsyncComponent } from 'vue';
import type { WorkflowsAdminApi } from './admin-api';
import { invalidateCatalog } from './keys';

/** Components load on first use, so the entry stays small. */
export const workflowsAdminApi: WorkflowsAdminApi = {
  CreateDialog: defineAsyncComponent(() => import('./components/WorkflowCreateDialog.vue')),
  invalidateCatalog,
};
