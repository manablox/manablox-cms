/**
 * The `workflows.workflow` code resource kind, reconciled by `CodeResourceService` through the
 * plugin resource kind contract; declarations are `resources.plugins['workflows.workflow']`.
 */

import { resolveCodeRefs } from '@manablox/core';
import { stableId } from '@manablox/core/node';
import type { SpaceRow } from '@manablox/db';
import {
  byEnvironment,
  CODE_ACTOR,
  defineResourceKind,
  type ResourceKindPlan,
  type ResourcePassContext,
  reasonOf,
  reconcileResources,
  type SyncChange,
  sameShape,
  syncEntry,
} from '@manablox/services';
import { WORKFLOW_RESOURCE_KIND, type WorkflowDefinition } from '../define/workflow.js';
import { snapWorkflowPosition, type WorkflowTrigger, workflowNodeIdRefs } from '../sdk.js';
import { workflowAuditor } from './audit.js';
import { workflowConfigExport } from './config-export.js';
import type { WorkflowRow, WorkflowWriteData } from './db/index.js';
import { workflowRepos } from './db/index.js';
import type { WorkflowRegistry } from './registry.js';
import { type ValidationEnvironment, validateWorkflow } from './validate/index.js';
import { snapshotOf } from './versions.js';

export const codeWorkflowId = (spaceId: string, slug: string): string =>
  stableId('workflow', `${spaceId}:${slug}`);

/** Workflows, slug to id, and every workflow's trigger by id for call nodes. */
interface WorkflowPlan extends ResourceKindPlan {
  workflows: Map<string, string>;
  triggers: Map<string, WorkflowTrigger>;
}

/** Workflows, each change published at once as a new version. */
const workflowKind = defineResourceKind<
  WorkflowDefinition,
  WorkflowRow[],
  WorkflowPlan,
  WorkflowRow
>({
  // The space's own workflows, written back as declarations by the config export.
  configExport: workflowConfigExport,
  load: ({ repos, spaces }) =>
    byEnvironment(
      workflowRepos(repos).workflows.listBySpaces(
        spaces.map((space) => space.id),
        'all',
      ),
    ),

  // A declared workflow's trigger wins: this pass writes it.
  plan: ({ declared, rows, key }) => {
    const workflows = new Map<string, string>();
    const triggers = new Map<string, WorkflowTrigger>();
    for (const row of rows) {
      if (row.slug) workflows.set(row.slug, row.id);
      triggers.set(row.id, row.trigger);
    }
    for (const definition of declared) {
      const id = workflows.get(definition.slug) ?? codeWorkflowId(key, definition.slug);
      workflows.set(definition.slug, id);
      triggers.set(id, definition.trigger);
    }
    return { workflows, triggers, resolve: (name) => workflows.get(name) };
  },

  reconcile: (context) => {
    const { manablox, repos, space, environment, key, declared, rows, options, plan } = context;
    const { registry } = manablox.plugins.require('workflows');
    const validation = environmentFor(context, registry);
    // Every change a sync writes is live at once, as a new version.
    const publish = async (row: WorkflowRow): Promise<WorkflowRow> => {
      await workflowRepos(repos).workflows.publish(row.id, {
        definition: snapshotOf(row),
        note: `Synced from ${row.sourceRef ?? 'the config'}`,
        publishedBy: CODE_ACTOR,
      });
      return (await workflowRepos(repos).workflows.findById(row.id)) ?? row;
    };

    return reconcileResources<
      WorkflowDefinition,
      WorkflowRow,
      Omit<WorkflowWriteData, 'id' | 'spaceId' | 'environmentId'>
    >(space, declared, options, {
      kind: WORKFLOW_RESOURCE_KIND,
      slug: (definition) => definition.slug,
      id: (definition) => codeWorkflowId(key, definition.slug),
      key: (definition) => definition.slug,
      rowKey: (row) => row.slug,
      taken: 'a workflow of this space already has that slug',
      // Slugless admin rows never match a declared slug.
      rows,
      audit: {
        create: 'workflows.workflow.create',
        update: 'workflows.workflow.update',
        auditor: workflowAuditor(repos, CODE_ACTOR),
      },
      create: async (id, fields) =>
        publish(
          await workflowRepos(repos).workflows.create({
            id,
            spaceId: space.id,
            environmentId: environment.id,
            ...fields,
          }),
        ),
      update: async (id, fields) =>
        publish(await workflowRepos(repos).workflows.update(id, fields)),
      prepare: (definition) => {
        let valid: ReturnType<typeof validateWorkflow>;
        try {
          const resolved = resolveCodeRefs(
            {
              name: definition.name,
              description: definition.description,
              trigger: definition.trigger,
              abortTriggers: definition.abortTriggers ?? [],
              nodes: definition.graph.nodes,
              edges: definition.graph.edges,
            },
            plan.resolve,
          );
          valid = validateWorkflow(resolved, validation, registry);
        } catch (error) {
          // Skip it; one invalid workflow must not stop the sync.
          return { skip: reasonOf(error) };
        }

        const credentialIds = valid.nodes
          .flatMap(workflowNodeIdRefs)
          .flatMap((ref) => (ref.kind === 'credential' && ref.id ? [ref.id] : []));
        const unfilled = credentialIds.some((id) => !plan.byId.get(id)?.filled);

        const desired = {
          name: valid.name,
          slug: definition.slug,
          description: valid.description,
          trigger: valid.trigger,
          abortTriggers: valid.abortTriggers,
          nodes: valid.nodes,
          edges: valid.edges,
          source: 'code' as const,
          sourceRef: definition.sourceRef ?? null,
        };

        return {
          desired,
          onCreate: { enabled: unfilled ? false : definition.enabled },
          ...(unfilled ? { reason: 'a credential it uses is empty, so it arrives off' } : {}),
          same: (row) =>
            row.source === 'code' &&
            row.sourceRef === desired.sourceRef &&
            row.publishedVersion !== null &&
            !row.draftChanged &&
            // Stored positions snapped as the definition's are: off-grid alone is no change.
            sameShape(desired, {
              ...row,
              nodes: row.nodes.map((node) => ({ ...node, ui: snapWorkflowPosition(node.ui) })),
            } as unknown as Record<string, unknown>),
        };
      },
    });
  },

  prune: ({ repos, space, declared, rows, options }) =>
    pruneRows({
      kind: WORKFLOW_RESOURCE_KIND,
      space,
      options,
      rows,
      declared: new Set(declared.map((declaration) => declaration.slug)),
      key: (row) => row.slug,
      remove: async (row) => {
        await workflowRepos(repos).workflows.delete(row.id);
        await workflowAuditor(repos, CODE_ACTOR).record('workflows.workflow.delete', row);
      },
      disable: async (row) => {
        await workflowRepos(repos).workflows.update(row.id, { enabled: false });
        await workflowAuditor(repos, CODE_ACTOR).record(
          'workflows.workflow.setEnabled',
          row,
          undefined,
          {
            enabled: false,
          },
        );
      },
    }),
});

/**
 * Handles code rows whose declaration is gone. Disabling is the default because rolling
 * deploys run two code versions at once and deletion drops run and delivery history.
 */
async function pruneRows<R extends { slug: string; source: string; enabled: boolean }>(spec: {
  kind: string;
  space: SpaceRow;
  options: ResourcePassContext['options'];
  rows: R[];
  declared: Set<string>;
  key: (row: R) => string;
  remove: (row: R) => Promise<void>;
  disable: (row: R) => Promise<void>;
}): Promise<SyncChange[]> {
  const { options } = spec;
  const changes: SyncChange[] = [];
  for (const row of spec.rows.filter((row) => row.source === 'code')) {
    if (spec.declared.has(spec.key(row))) continue;
    changes.push(
      syncEntry(spec.kind, row.slug, spec.space, options.prune ? 'deleted' : 'disabled'),
    );
    if (options.dryRun) continue;
    if (options.prune) await spec.remove(row);
    else if (row.enabled) await spec.disable(row);
  }
  return changes;
}

/** The `validateWorkflow` environment, built from the plan so dry runs validate too. */
function environmentFor(
  { manablox, plan }: ResourcePassContext<WorkflowDefinition, WorkflowRow[]>,
  registry: WorkflowRegistry,
): ValidationEnvironment {
  const contentTypes = manablox.contentTypes;
  const triggers = plan.part<WorkflowPlan>(WORKFLOW_RESOURCE_KIND)?.triggers ?? new Map();
  const part = <P>(kind: string) => plan.part(kind) as P | undefined;
  const data = new Map<string, unknown>();
  for (const kind of [...registry.triggerKinds, ...registry.abortTriggerKinds]) {
    if (!data.has(kind.kind) && kind.planned) data.set(kind.kind, kind.planned(part));
  }
  return {
    typeExists: (typeId: string) => {
      const type = contentTypes.tryGet(typeId);
      return type !== undefined && contentTypes.inScope(type, plan.types);
    },
    credentialKind: (id: string) => plan.byId.get(id)?.kind ?? null,
    triggerData: (kind: string) => data.get(kind),
    workflowTrigger: (id: string) => triggers.get(id) ?? null,
  };
}

/** The `workflows.workflow` code resource kind: workflows, each change published at once. */
export const workflowResourceKinds = { [WORKFLOW_RESOURCE_KIND]: workflowKind };
