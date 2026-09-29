import type { AdminSlotEntry } from '@manablox/admin-plugin';
import {
  api as coreApi,
  keys as coreKeys,
  downloadFile,
  invalidate,
  optimistic,
  required,
  type SpaceRef,
  slotEntries,
  spaceWrites,
  useSpacePagedQuery,
  useSpaceQuery,
} from '@manablox/admin-sdk';
import { slugDraft } from '@manablox/core';
import { type MaybeRefOrGetter, toValue } from 'vue';
import {
  isActiveRunStatus,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowTrigger,
} from '../sdk';
import { workflowsApi as api } from './client';
import { invalidateWorkflows, workflowKeys as keys } from './keys';
import type { WorkflowDesign } from './model/draft';
import { autoLayout } from './model/layout';

/** A row of the workflow list. */
export type WorkflowListItem = Awaited<ReturnType<typeof api.list>>['items'][number];

/** Workflows the side list loads; past this it links to the full list. */
const PANEL_WORKFLOWS = 200;

/** The first workflows of a space, for the side list, with the total. */
export function useWorkflows(spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.page(space, { limit: PANEL_WORKFLOWS }),
    (id) => api.list({ spaceId: id, pagination: { limit: PANEL_WORKFLOWS } }),
    { spaceId },
  );
}

/** Workflows per page of the list. */
export const WORKFLOW_PAGE_SIZE = 25;

/** One page of a space's workflows. */
export function useWorkflowPage(spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (space, page) => keys.page(space, { page, limit: WORKFLOW_PAGE_SIZE }),
    (space, pagination) => api.list({ spaceId: space, pagination }),
    { spaceId, pageSize: WORKFLOW_PAGE_SIZE },
  );
}

export function useWorkflow(id: MaybeRefOrGetter<string>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.detail(space, toValue(id)),
    (space) => api.get({ spaceId: space, id: toValue(id) }),
    { spaceId, enabled: () => Boolean(toValue(id)) },
  );
}

/** Which runs the history shows. */
export interface RunHistoryQuery {
  status?: WorkflowRunStatus[] | undefined;
  test?: boolean | undefined;
}

/** Runs per page of the history. */
export const RUN_PAGE_SIZE = 25;

/** A page of a workflow's run history, polled while any run on it is active; a new filter starts at the first page. */
export function useWorkflowRunHistory(
  id: MaybeRefOrGetter<string>,
  query: MaybeRefOrGetter<RunHistoryQuery>,
  enabled: MaybeRefOrGetter<boolean> = true,
  spaceId?: SpaceRef,
) {
  return useSpacePagedQuery(
    (space, page) => keys.runHistory(space, toValue(id), { ...toValue(query), page }),
    (space, pagination) =>
      api.runHistory({ spaceId: space, id: toValue(id), ...toValue(query), pagination }),
    {
      spaceId,
      pageSize: RUN_PAGE_SIZE,
      resetOn: [() => JSON.stringify(toValue(query)), () => toValue(id)],
      enabled: () => Boolean(toValue(id)) && toValue(enabled),
      refetchInterval: (state) =>
        state.state.data?.items.some((run) => isActiveRunStatus(run.status)) ? 5000 : false,
    },
  );
}

/** One run with its steps and the definition it walked, polled while active. */
export function useWorkflowRun(runId: MaybeRefOrGetter<string | null>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.run(space, toValue(runId)),
    (space) => api.run({ spaceId: space, id: required(toValue(runId)) }),
    {
      spaceId,
      enabled: () => Boolean(toValue(runId)),
      refetchInterval: (state) =>
        state.state.data && isActiveRunStatus(state.state.data.status) ? 3000 : false,
    },
  );
}

/** Versions per page of the list. */
export const VERSION_PAGE_SIZE = 25;

/** A page of published versions, newest first. */
export function useWorkflowVersions(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true,
  spaceId?: SpaceRef,
) {
  return useSpacePagedQuery(
    (space, page) => keys.versionPage(space, toValue(id), page),
    (space, pagination) => api.versions({ spaceId: space, id: toValue(id), pagination }),
    {
      spaceId,
      pageSize: VERSION_PAGE_SIZE,
      resetOn: [() => toValue(id)],
      enabled: () => Boolean(toValue(id)) && toValue(enabled),
    },
  );
}

/** One published version with its graph; versions never change. */
export function useWorkflowVersion(
  id: MaybeRefOrGetter<string>,
  version: MaybeRefOrGetter<number>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.version(space, toValue(id), toValue(version)),
    (space) => api.version({ spaceId: space, id: toValue(id), version: toValue(version) }),
    {
      spaceId,
      enabled: () => Boolean(toValue(id)) && toValue(version) > 0,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );
}

/** Events, actions with their forms, operators and credentials. Keyed by space for the credentials. */
export function useWorkflowCatalog(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.catalog, (id) => api.catalog({ spaceId: id }), {
    spaceId,
    staleTime: 5 * 60_000,
  });
}

/** A workflow as the editor loads it. */
export type Workflow = Awaited<ReturnType<typeof api.get>>;
/** A row of a run history. */
type WorkflowRunListItem = Awaited<ReturnType<typeof api.runHistory>>['items'][number];
/** A version as the list shows it, without its graph. */
export type WorkflowVersionSummary = Awaited<ReturnType<typeof api.versions>>['items'][number];
/** What the editor draws its palette, forms and pickers from. */
export type WorkflowCatalog = Awaited<ReturnType<typeof api.catalog>>;

type WorkflowRunStatus = WorkflowRunListItem['status'];

const write = spaceWrites(invalidateWorkflows);

type WorkflowInput = Parameters<typeof api.create>[0];

type Switchable = { id: string; enabled: boolean };
/** A cached list under the list key: a page, or rows. */
type ListData = Switchable[] | { items: Switchable[]; total: number };

/**
 * A validated, disabled workflow a model designed from a description, laid out as the tidy
 * button does; writes nothing. Not found without the AI plugin, whose pane asks for it.
 */
export async function designWorkflow(
  spaceId: string,
  input: { prompt: string; providerKind?: string },
): Promise<WorkflowDesign> {
  const result = await api.design({ spaceId, ...input });
  const workflow = result.workflow as {
    name: string;
    description?: string | null;
    trigger: WorkflowTrigger;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  return {
    name: workflow.name,
    description: workflow.description ?? null,
    trigger: workflow.trigger,
    nodes: autoLayout(workflow.nodes, workflow.edges),
    edges: workflow.edges,
    notes: result.notes,
    problems: result.problems,
  };
}

/** Workflow writes, each with its invalidation. */
export const workflows = {
  create: write.withInput((input: WorkflowInput) => api.create(input)),
  /** Saves the draft; with `publish`, also makes it the live version. */
  update: write.withInput((input: WorkflowInput & { id: string }) => api.update(input)),
  /** Makes the saved draft the next live version. */
  publish: write.withSpace((spaceId: string, id: string, note: string | null) =>
    api.publish({ spaceId, id, note }),
  ),
  /** Copies a version into the draft. */
  restoreVersion: write.withSpace((spaceId: string, id: string, version: number) =>
    api.restoreVersion({ spaceId, id, version }),
  ),
  /** A disabled copy, returned so the caller can open it. */
  duplicate: write.withSpace((spaceId: string, id: string) => api.duplicate({ spaceId, id })),
  /** Flips the switch in the cached list and detail first; puts it back if the write fails. */
  setEnabled: write.withSpace(async (spaceId: string, id: string, enabled: boolean) => {
    const flip = (row: Switchable) => (row.id === id ? { ...row, enabled } : row);
    const rollbacks = [
      await optimistic<ListData>(keys.list(spaceId), (list) =>
        Array.isArray(list) ? list.map(flip) : { ...list, items: list.items.map(flip) },
      ),
      await optimistic<Switchable>(keys.detail(spaceId, id), flip),
    ];
    try {
      return await api.setEnabled({ spaceId, id, enabled });
    } catch (error) {
      for (const rollback of rollbacks) rollback();
      throw error;
    }
  }),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.delete({ spaceId, id });
  }),
  /** Test-runs the draft with sample input: a document, call values or a sample call. */
  runNow: write.withSpace((spaceId: string, id: string, sample: TestSample = {}) =>
    api.runNow({ spaceId, id, ...sample }),
  ),
  /** Starts the live version of a manual workflow with the values it takes. */
  start: write.withSpace((spaceId: string, id: string, input: Record<string, string>) =>
    api.start({ spaceId, id, input }),
  ),
  /** Stops one active run. */
  abortRun: write.withSpace((spaceId: string, id: string) => api.abortRun({ spaceId, id })),
  /** Stops every active run of a workflow. */
  abortRuns: write.withSpace((spaceId: string, id: string) => api.abortRuns({ spaceId, id })),
  /** A disabled workflow from an exported file, with what the import changed. */
  import: write.withSpace(async (spaceId: string, file: WorkflowFileInput) => {
    const result = await api.import({ spaceId, file });
    // It may have created credentials and what its triggers point at, e.g. endpoints.
    invalidate.credentials(spaceId);
    for (const { entry } of slotEntries('workflows:triggerForm')) {
      (entry as AdminSlotEntry<'workflows:triggerForm'>).imported?.(spaceId);
    }
    return result;
  }),
};

type WorkflowFileInput = Parameters<typeof api.import>[0]['file'];

/** What a test run starts from. */
export type TestSample = Omit<Parameters<typeof api.runNow>[0], 'spaceId' | 'id'>;

/** Downloads the saved draft, or a version, as a file another space can import. */
export async function exportWorkflowFile(
  spaceId: string,
  id: string,
  name: string,
  version?: number,
): Promise<void> {
  const file = await api.export({ spaceId, id, ...(version ? { version } : {}) });
  const base = slugDraft(name, { final: true }) || 'workflow';
  downloadFile(
    `${base}${version ? `-v${version}` : ''}.workflow.json`,
    'application/json',
    `${JSON.stringify(file, null, 2)}\n`,
  );
}

/** The space's roles, for role fields; fetched while `enabled`. */
export function useSpaceRoles(enabled: MaybeRefOrGetter<boolean>) {
  return useSpaceQuery(coreKeys.roles.all, (id) => coreApi.roles.list({ spaceId: id }), {
    enabled,
  });
}

/** The space's members, for user fields; fetched while `enabled`. */
export function useSpaceMembers(enabled: MaybeRefOrGetter<boolean>) {
  return useSpaceQuery(coreKeys.spaces.members, (id) => coreApi.spaces.members({ spaceId: id }), {
    enabled,
  });
}
