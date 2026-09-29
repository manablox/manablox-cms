import { CREDENTIAL_KINDS, type CredentialKind, ManabloxError, slugify } from '@manablox/core';
import type { CredentialRow } from '@manablox/db';
import type { WorkflowFileRecord } from '../../define/triggers.js';
import {
  type WorkflowAbortTrigger,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeIdRef,
  type WorkflowSnapshot,
  type WorkflowTrigger,
  workflowNodeIdRefs,
} from '../../sdk.js';
import type { WorkflowRow } from '../db/index.js';
import type { WorkflowRegistry } from '../registry.js';
import { snapshotOf } from '../versions.js';

export const WORKFLOW_FILE_FORMAT = 'manablox.workflow';
export const WORKFLOW_FILE_VERSION = 1;

/** A credential the workflow uses, without its secret; matched by slug on import. */
export interface WorkflowFileCredential {
  id: string;
  name: string;
  slug: string;
  kind: CredentialKind;
  provider: string;
}

/** A workflow the file's call nodes run; not in the file, matched by slug or name on import. */
export interface WorkflowFileCalled {
  id: string;
  name: string;
  /** Empty for admin-made workflows. */
  slug: string;
}

/**
 * One workflow as a portable JSON file. Ids are only references within the file. The records
 * its triggers point at, such as incoming endpoints, sit in the lists their kinds name
 * (`webhooks`), without secrets.
 */
export interface WorkflowFile {
  format: typeof WORKFLOW_FILE_FORMAT;
  version: typeof WORKFLOW_FILE_VERSION;
  exportedAt: string;
  workflow: WorkflowSnapshot;
  credentials: WorkflowFileCredential[];
  workflows: WorkflowFileCalled[];
  [list: string]: unknown;
}

/** The ids of records a workflow's triggers point at, by the file list their kind names. */
export function triggerRefsOf(
  registry: WorkflowRegistry,
  workflow: Pick<WorkflowSnapshot, 'trigger' | 'abortTriggers'>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (file: string, ids: string[]) => {
    const set = out.get(file) ?? new Set<string>();
    for (const id of ids) if (id) set.add(id);
    out.set(file, set);
  };
  const refs = registry.trigger(workflow.trigger.kind)?.refs;
  if (refs) add(refs.file, refs.ids(workflow.trigger));
  for (const trigger of workflow.abortTriggers) {
    const own = registry.abortTrigger(trigger.kind)?.refs;
    if (own) add(own.file, own.ids(trigger));
  }
  return out;
}

export function buildWorkflowFile(
  workflow: WorkflowRow,
  credentials: CredentialRow[],
  records: Record<string, WorkflowFileRecord[]>,
  workflows: ReadonlyArray<Pick<WorkflowRow, 'id' | 'name' | 'slug'>>,
  registry: WorkflowRegistry,
  now: Date,
): WorkflowFile {
  const refs = workflow.nodes.flatMap(workflowNodeIdRefs);
  const idsOf = (kind: WorkflowNodeIdRef['kind']) =>
    new Set(refs.flatMap((ref) => (ref.kind === kind && ref.id ? [ref.id] : [])));
  const called = idsOf('workflow');
  const usedCredentials = idsOf('credential');
  for (const [file, list] of Object.entries(records)) {
    const reader = fileOf(registry, file);
    for (const record of list) {
      for (const id of reader?.credentials?.(record) ?? []) usedCredentials.add(id);
    }
  }

  return {
    format: WORKFLOW_FILE_FORMAT,
    version: WORKFLOW_FILE_VERSION,
    exportedAt: now.toISOString(),
    workflow: snapshotOf(workflow),
    credentials: credentials
      .filter((row) => usedCredentials.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        provider: row.provider,
      })),
    ...records,
    workflows: workflows
      .filter((row) => called.has(row.id))
      .map((row) => ({ id: row.id, name: row.name, slug: row.slug })),
  };
}

/** The file side of the trigger kind whose records sit in the list `file`. */
export function fileOf(registry: WorkflowRegistry, file: string) {
  return registry.triggerKinds.find((kind) => kind.refs?.file === file && kind.file)?.file;
}

/** Every list of records a trigger kind carries in files. */
export function fileLists(registry: WorkflowRegistry): string[] {
  return [
    ...new Set(
      registry.triggerKinds.flatMap((kind) => (kind.refs && kind.file ? [kind.refs.file] : [])),
    ),
  ];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** Checks a file's envelope; the workflow itself is validated like a save. */
export function readWorkflowFile(raw: unknown, registry: WorkflowRegistry): WorkflowFile {
  const invalid = () => ManabloxError.badRequest('plugins.workflows.import.invalid');
  if (!isObject(raw) || raw.format !== WORKFLOW_FILE_FORMAT) throw invalid();
  if (typeof raw.version !== 'number') throw invalid();
  if (raw.version > WORKFLOW_FILE_VERSION) {
    throw ManabloxError.badRequest('plugins.workflows.import.versionUnsupported', {
      version: raw.version,
    });
  }
  const workflow = readSnapshot(raw.workflow);
  if (!workflow) throw invalid();

  return {
    format: WORKFLOW_FILE_FORMAT,
    version: WORKFLOW_FILE_VERSION,
    exportedAt: str(raw.exportedAt),
    workflow,
    credentials: readCredentials(raw.credentials),
    ...Object.fromEntries(
      fileLists(registry).map((file) => [file, fileOf(registry, file)?.read(raw[file]) ?? []]),
    ),
    workflows: readCalled(raw.workflows),
  };
}

/** A workflow definition from loose JSON; null when its shape is wrong. */
export function readSnapshot(workflow: unknown): WorkflowSnapshot | null {
  if (
    !isObject(workflow) ||
    !isObject(workflow.trigger) ||
    !Array.isArray(workflow.nodes) ||
    !Array.isArray(workflow.edges)
  ) {
    return null;
  }
  return {
    name: str(workflow.name),
    description: typeof workflow.description === 'string' ? workflow.description : null,
    trigger: workflow.trigger as unknown as WorkflowTrigger,
    abortTriggers: (Array.isArray(workflow.abortTriggers)
      ? workflow.abortTriggers
      : []) as WorkflowAbortTrigger[],
    nodes: workflow.nodes as WorkflowNode[],
    edges: workflow.edges as WorkflowEdge[],
  };
}

const listOf = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : []).filter(isObject);

export function readCredentials(value: unknown): WorkflowFileCredential[] {
  return listOf(value)
    .filter(
      (entry) =>
        str(entry.id) &&
        slugify(str(entry.slug)) &&
        (CREDENTIAL_KINDS as readonly unknown[]).includes(entry.kind),
    )
    .map((entry) => ({
      id: str(entry.id),
      name: str(entry.name).trim().slice(0, 200) || slugify(str(entry.slug)),
      slug: slugify(str(entry.slug)),
      kind: entry.kind as CredentialKind,
      provider: str(entry.provider),
    }));
}

function readCalled(value: unknown): WorkflowFileCalled[] {
  return listOf(value)
    .filter((entry) => str(entry.id) && str(entry.name).trim())
    .map((entry) => ({
      id: str(entry.id),
      name: str(entry.name).trim().slice(0, 200),
      slug: str(entry.slug),
    }));
}
