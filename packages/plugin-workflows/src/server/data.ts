import { DAY_MS, type Scope } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import { copyId, defineDataProvider, keepChosen, runtimeOnly, same } from '@manablox/services';
import type {} from '../index.js';
import { workflowNodeIdRefs } from '../sdk.js';
import {
  type WorkflowRow,
  type WorkflowVersionRow,
  withVersion,
  workflowRepos,
} from './db/index.js';
import { workflowKeys } from './keys.js';
import {
  type ExportedCalledWorkflow,
  type ExportedWorkflow,
  type ExportedWorkflowEntry,
  isExportedWorkflow,
} from './transfer/index.js';

/** A workflow with its published versions, as an environment holds it. */
export type WorkflowEnvironmentRow = WorkflowRow & { versions: WorkflowVersionRow[] };

/** The parts of a workflow a version freezes, as the promote diff compares them. */
const definition = (row: {
  name: string;
  description: string | null;
  trigger: unknown;
  abortTriggers: unknown;
  nodes: unknown;
  edges: unknown;
}) => ({
  name: row.name,
  description: row.description,
  trigger: row.trigger,
  abortTriggers: row.abortTriggers,
  nodes: row.nodes,
  edges: row.edges,
});

const publishedOf = (row: WorkflowEnvironmentRow) =>
  row.versions.find((version) => version.version === row.publishedVersion) ?? null;

/** An environment's workflows with their versions. */
async function environmentRows(
  repos: Repositories,
  environmentId: string,
): Promise<WorkflowEnvironmentRow[]> {
  const store = workflowRepos(repos).workflows;
  const rows = await store.listByEnvironment(environmentId);
  const versions = await store.listVersionsOf(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    versions: versions.filter((version) => version.workflowId === row.id),
  }));
}

/** A workflow as the export holds it, with its published definition when the draft moved on. */
async function exportWorkflow(repos: Repositories, row: WorkflowRow): Promise<ExportedWorkflow> {
  const exported: ExportedWorkflow = {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    trigger: row.trigger,
    abortTriggers: row.abortTriggers,
    nodes: row.nodes,
    edges: row.edges,
    published: row.publishedVersion !== null,
  };
  if (!row.draftChanged || row.publishedVersion === null) return exported;
  const version = await workflowRepos(repos).workflows.findVersion(row.id, row.publishedVersion);
  if (!version) return exported;
  return { ...exported, live: definition(withVersion(row, version)) as ExportedWorkflow['live'] };
}

/** Call targets of the exported workflows that the section does not hold. */
function calledOutside(
  exported: ExportedWorkflow[],
  rows: ReadonlyArray<Pick<WorkflowRow, 'id' | 'name' | 'slug'>>,
): ExportedCalledWorkflow[] {
  const inFile = new Set(exported.map((workflow) => workflow.id));
  const ids = new Set(
    exported
      .flatMap((workflow) => (workflow.live ? [workflow, workflow.live] : [workflow]))
      .flatMap((entry) => entry.nodes.flatMap(workflowNodeIdRefs))
      .flatMap((ref) => (ref.kind === 'workflow' && ref.id && !inFile.has(ref.id) ? [ref.id] : [])),
  );
  return rows
    .filter((row) => ids.has(row.id))
    .map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

/**
 * The workflows of a space: environment copies and promotes, the transfer section, run
 * retention and the active-workflow count.
 */
export const workflowsData = defineDataProvider<WorkflowEnvironmentRow, ExportedWorkflowEntry>({
  kind: 'workflows.workflows',
  environments: {
    key: 'workflows',
    load: ({ repos, environmentId }) => environmentRows(repos, environmentId),
    match: (row) => row.slug || null,
    // Code workflows sync on their own and stay.
    keep: (row) => row.source !== 'runtime',
    promotes: (row) => row.source !== 'code',
    describe: (row) => ({
      label: row.name,
      value: { ...definition(row), published: definitionOf(publishedOf(row)) },
    }),
    // Copies arrive switched off; their versions take ids of the target environment.
    async copy({ repos, rows, to }) {
      const store = workflowRepos(repos).workflows;
      for (const { versions, ...workflow } of rows) {
        await store.insertRow({
          ...workflow,
          enabled: false,
          lastScheduledAt: null,
          lastRunAt: null,
        });
        await store.insertVersionRows(
          versions.map((version) => ({ ...version, id: copyId(to.id, version.id) })),
        );
      }
    },
    async promote({ repos, upsert, remove, production, environment, productionId }) {
      const store = workflowRepos(repos).workflows;
      const before = new Map(production.map((workflow) => [workflow.id, workflow]));
      await store.removeRows(remove.map((row) => row.id));
      for (const { versions: staged, ...workflow } of upsert) {
        const previous = before.get(workflow.id);
        if (!previous) {
          // New workflows arrive switched off.
          await store.insertRow({
            ...workflow,
            enabled: false,
            lastScheduledAt: null,
            lastRunAt: null,
          });
          await store.insertVersionRows(
            staged.map((version) => ({ ...version, id: copyId(productionId, version.id) })),
          );
          continue;
        }
        const published = staged.find((row) => row.version === workflow.publishedVersion);
        const current = publishedOf(previous);
        const patch: Partial<WorkflowRow> = {
          name: workflow.name,
          slug: workflow.slug,
          description: workflow.description,
          trigger: workflow.trigger,
          abortTriggers: workflow.abortTriggers,
          nodes: workflow.nodes,
          edges: workflow.edges,
          draftChanged: workflow.draftChanged,
          updatedAt: new Date(),
        };
        if (published && (!current || !same(definition(published), definition(current)))) {
          const version = Math.max(0, ...previous.versions.map((row) => row.version)) + 1;
          const { id: _id, ...copy } = published;
          await store.insertVersionRows([
            {
              ...copy,
              workflowId: workflow.id,
              version,
              note: `Promoted from ${environment}`,
              createdAt: new Date(),
            },
          ]);
          Object.assign(patch, {
            publishedVersion: version,
            triggerKind: workflow.triggerKind,
            publishedAt: new Date(),
          });
        }
        // Production's enabled state stays.
        await store.updateRow(workflow.id, patch);
      }
    },
    // Live triggers are cached per process; this one forgets them, the channel tells the rest.
    // A process without the plugin's services (a bare service context) has nothing cached.
    onLiveChange({ manablox, spaceId }) {
      const services = manablox.plugins.get('workflows');
      if (!services) return;
      services.engine.forgetLive(spaceId);
      services.live.publish({ spaceId });
    },
  },
  transfer: {
    section: {
      label: 'Workflows',
      dependsOn: ['contentTypes', 'credentials', 'webhooks.webhooks'],
    },
    count: ({ repos, spaceId }) => workflowRepos(repos).workflows.countRuntimeBySpace(spaceId),
    entries: async ({ repos, spaceId }) =>
      runtimeOnly(await workflowRepos(repos).workflows.listBySpace(spaceId)).map((row) => ({
        id: row.id,
        label: row.name,
      })),
    // Workflows the picked ones call travel as references.
    async export({ repos, scope, picked }) {
      const all = await workflowRepos(repos).workflows.listBySpace(scope as Scope);
      const rows = keepChosen(runtimeOnly(all), picked);
      const exported = await Promise.all(rows.map((row) => exportWorkflow(repos, row)));
      return [...exported, ...calledOutside(exported, all)];
    },
    ids: (entries) => entries.filter(isExportedWorkflow).map((entry) => entry.id),
    limits: (entries) => ({
      [workflowKeys.limits.active]: entries
        .filter(isExportedWorkflow)
        .filter((entry) => entry.enabled).length,
    }),
    async check({ manablox, spaceId }, entries) {
      const workflows = entries.filter(isExportedWorkflow);
      if (!workflows.length) return;
      await manablox.controls.assertFeature(spaceId, workflowKeys.feature);
      if (!manablox.hooks.has('workflows:beforeEnable')) return;
      for (const workflow of workflows) {
        if (!workflow.enabled) continue;
        const name = workflow.live?.name ?? workflow.name;
        await manablox.hooks.run(
          'workflows:beforeEnable',
          { spaceId, id: workflow.id, name },
          { manablox, spaceId },
        );
      }
    },
    // After credentials and the records triggers point at, which it keeps by id.
    // Credentials and records left behind are recreated from the file's rows of them.
    async import({ manablox, repos, spaceId, notes, carried }, entries) {
      const result = await manablox.plugins
        .require('workflows')
        .workflows.importSpace(repos, spaceId, entries, carried);
      notes.push(...result.notes);
    },
  },
  retention: [
    {
      key: 'plugins.workflows.runsDays',
      prune: ({ repos, spaceId, limit }, days) =>
        workflowRepos(repos).runs.prune(undefined, {
          spaceId,
          before: new Date(Date.now() - days * DAY_MS),
          limit,
        }),
    },
  ],
  counters: {
    [workflowKeys.limits.active]: ({ repos }, spaceIds) =>
      workflowRepos(repos).workflows.countActive(spaceIds),
  },
});

/** A version's definition, or null. */
function definitionOf(version: WorkflowVersionRow | null) {
  return version ? definition(version) : null;
}
