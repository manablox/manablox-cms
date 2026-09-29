import { defineAdminPlugin, enabledSwitchOutcome } from '@manablox/admin-plugin';
import { invalidate, onInvalidated } from '@manablox/admin-sdk';
import { workflowsAdminApi } from './api';
import { invalidateCatalog, invalidateWorkflows } from './keys';
import { WORKFLOWS_HTTP, WORKFLOWS_MAIL } from './model/nodes';
import './style.css';

export type * from './admin-api';
export type * from './slots';

const workflowRoute = (targetId: string | null) => (targetId ? `/workflows/${targetId}` : null);
/** A run links to its workflow. */
const runRoute = (_targetId: string | null, meta: Record<string, unknown> | null) =>
  typeof meta?.workflowId === 'string' ? `/workflows/${meta.workflowId}` : null;

const WORKFLOW_ENTITY = { label: 'Workflow', route: workflowRoute };
const RUN_ENTITY = { label: 'Workflow run', route: runRoute };

/** A run's outcome beside the badge. */
const runOutcome = (meta: Record<string, unknown> | null) =>
  typeof meta?.status === 'string' ? meta.status : null;

/** The workflow actions, by verb. */
const ACTIONS: Record<string, [label: string, verb: string]> = {
  'workflows.workflow.create': ['Created a workflow', 'Created'],
  'workflows.workflow.duplicate': ['Duplicated a workflow', 'Duplicated'],
  'workflows.workflow.update': ['Edited a workflow', 'Edited'],
  'workflows.workflow.publish': ['Published a workflow', 'Published'],
  'workflows.workflow.restoreVersion': ['Restored a workflow version to the draft', 'Restored'],
  'workflows.workflow.setEnabled': ['Switched a workflow on or off', 'Switched'],
  'workflows.workflow.delete': ['Deleted a workflow', 'Deleted'],
  'workflows.workflow.runNow': ['Test-ran a workflow', 'Test-ran'],
  'workflows.workflow.start': ['Started a workflow by hand', 'Started'],
  'workflows.workflow.export': ['Exported a workflow', 'Exported'],
  'workflows.workflow.import': ['Imported a workflow', 'Imported'],
  'workflows.run.finish': ['A workflow run finished', 'Run finished'],
  'workflows.run.abort': ['Aborted a workflow run', 'Aborted'],
};
const actions = Object.fromEntries(Object.entries(ACTIONS).map(([name, [label]]) => [name, label]));
const verbs = Object.fromEntries(Object.entries(ACTIONS).map(([name, [, verb]]) => [name, verb]));

/**
 * Workflows: the list, the canvas editor, versions and runs, and the slots other plugins fill
 * with trigger kinds (`workflows:triggerForm`), action forms (`workflows:nodeForm`), field
 * controls (`workflows:fieldControl`) and ways to create one (`workflows:createActions`).
 */
export default defineAdminPlugin({
  name: 'workflows',
  routes: [
    {
      path: 'workflows',
      name: 'workflows',
      component: () => import('./pages/WorkflowList.vue'),
      section: '/workflows',
      panel: 'workflows',
    },
    {
      path: 'workflows/:id',
      name: 'workflow-edit',
      component: () => import('./pages/WorkflowEdit.vue'),
      section: '/workflows',
      panel: 'workflows',
      editor: 'edit',
    },
    {
      path: 'workflows/:id/versions/:version',
      name: 'workflow-version',
      component: () => import('./pages/WorkflowVersion.vue'),
      section: '/workflows',
      panel: 'workflows',
    },
    {
      path: 'workflows/:id/runs/:runId',
      name: 'workflow-run',
      component: () => import('./pages/WorkflowRun.vue'),
      section: '/workflows',
      panel: 'workflows',
    },
  ],
  menu: [
    {
      label: 'Workflows',
      icon: 'workflow',
      to: '/workflows',
      group: 'automation',
      order: 100,
      permission: 'workflows:read',
      shortcut: 'w',
    },
  ],
  sidePanels: [
    {
      key: 'workflows',
      label: 'Workflows',
      icon: 'workflow',
      component: () => import('./components/WorkflowSideList.vue'),
    },
  ],
  transferSections: [
    {
      kind: 'workflows.workflows',
      group: 'integrations',
      icon: 'workflow',
      label: 'Workflows',
      description: 'Definitions only, not past runs.',
      noun: ['workflow', 'workflows'],
      pickable: true,
    },
  ],
  realtime: {
    'workflows.workflow': (event) => {
      invalidateWorkflows(event.spaceId);
      // An import may have added credentials.
      invalidate.credentials(event.spaceId);
    },
    'workflows.run': (event) => invalidateWorkflows(event.spaceId),
  },
  audit: {
    entities: {
      'workflows.workflow': WORKFLOW_ENTITY,
      'workflows.run': RUN_ENTITY,
    },
    actions,
    verbs,
    outcomes: {
      'workflows.run.finish': runOutcome,
      'workflows.workflow.setEnabled': enabledSwitchOutcome,
    },
    actors: {
      workflows: { label: 'Workflow', icon: 'workflow' },
    },
  },
  features: {
    'plugins.workflows': 'Workflows',
    [WORKFLOWS_HTTP]: 'The HTTP workflow steps',
    [WORKFLOWS_MAIL]: 'The mail workflow steps',
  },
  permissionIcons: { 'plugins.workflows': 'workflow' },
  usage: {
    'plugins.workflows.runs': { label: 'Workflow runs', blocked: 'Workflows do not start.' },
  },
  diffKinds: { workflows: 'Workflows' },
  // A promote replaces production's workflows.
  invalidateOnPromote: invalidateWorkflows,
  setup({ defineSlot, expose }) {
    defineSlot('triggerForm');
    defineSlot('nodeForm');
    defineSlot('fieldControl');
    defineSlot('createActions');
    expose(workflowsAdminApi);
    // The catalogue lists the credentials a node may name.
    onInvalidated('credentials', invalidateCatalog);
  },
});
