import { ManabloxError } from '@manablox/core';
import type {
  WorkflowAbortTrigger,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTrigger,
} from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import { fileLists, fileOf, readCredentials, readSnapshot, str } from './file.js';
import type { WorkflowImportEntry, WorkflowImportSource } from './plan.js';

/** The parts of a workflow a version freezes. */
export interface ExportedWorkflowDefinition {
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** A workflow in a space export's `workflows.workflows` section. */
export interface ExportedWorkflow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Whether it had a published version. */
  published: boolean;
  /** The published definition; absent when the draft is the same. */
  live?: ExportedWorkflowDefinition | null | undefined;
}

/**
 * A workflow the exported ones call that the file lacks, matched by slug, then by name, on
 * import.
 */
export interface ExportedCalledWorkflow {
  id: string;
  name: string;
  slug: string;
}

/** An entry of the section: a workflow, or a call target outside it. */
export type ExportedWorkflowEntry = ExportedWorkflow | ExportedCalledWorkflow;

/** Whether an entry is a workflow rather than a call target. */
export const isExportedWorkflow = (entry: ExportedWorkflowEntry): entry is ExportedWorkflow =>
  'trigger' in entry;

/**
 * A space export's workflows as an import source. Credentials and the records triggers point
 * at come from the file's own sections (`carried`): restored with the space they keep their
 * ids and are matched, left behind they are recreated by slug.
 */
export function readSpaceWorkflows(
  entries: readonly ExportedWorkflowEntry[],
  registry: WorkflowRegistry,
  carried: (kind: string) => readonly unknown[] = () => [],
): WorkflowImportSource {
  return {
    workflows: entries.filter(isExportedWorkflow).flatMap((entry): WorkflowImportEntry[] => {
      const draft = readSnapshot(entry);
      if (!draft || !str(entry.id)) {
        throw ManabloxError.badRequest('plugins.workflows.import.invalid');
      }
      return [
        {
          id: entry.id,
          draft,
          live: entry.live ? readSnapshot(entry.live) : null,
          enabled: entry.enabled === true,
          publish: entry.published,
        },
      ];
    }),
    credentials: readCredentials(carried('credentials')),
    records: Object.fromEntries(
      fileLists(registry).map((file) => {
        const spec = fileOf(registry, file);
        return [file, spec?.read(carried(spec.section ?? file)) ?? []];
      }),
    ),
    called: entries
      .filter((entry): entry is ExportedCalledWorkflow => !isExportedWorkflow(entry))
      .map((entry) => ({ id: str(entry.id), name: str(entry.name), slug: str(entry.slug) }))
      .filter((entry) => entry.id && entry.name.trim()),
  };
}
