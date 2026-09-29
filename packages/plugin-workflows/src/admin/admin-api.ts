/**
 * What other bundles get from `usePluginApi<WorkflowsAdminApi>('workflows')`; undefined
 * without the plugin. Published types-only as `@manablox/plugin-workflows/admin-api`.
 */
import type { DefineSetupFnComponent } from 'vue';

/** Props of the new workflow dialog. */
export interface WorkflowCreateDialogProps {
  spaceId: string;
  /** Preselects this trigger kind, pointed at `preset`, e.g. `{ kind: 'webhook', preset: endpointId }`. */
  kind?: string | null;
  preset?: string | null;
}

export interface WorkflowsAdminApi {
  /** The new workflow dialog; emits `close`. */
  CreateDialog: DefineSetupFnComponent<WorkflowCreateDialogProps, { close: () => true }>;
  /** Drops the editor's catalogue of a space, e.g. after writes to what a trigger may name. */
  invalidateCatalog: (spaceId: string | null) => void;
}
