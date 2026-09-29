import { randomUUID } from 'node:crypto';
import { copyName } from '@manablox/core';
import type { CredentialRow } from '@manablox/db';
import type { WorkflowFileRecord } from '../../define/triggers.js';
import {
  remapNodeIds,
  type WorkflowAbortTrigger,
  type WorkflowSnapshot,
  type WorkflowTrigger,
  workflowNodeIdRefs,
} from '../../sdk.js';
import type { WorkflowSummary } from '../db/index.js';
import type { WorkflowRegistry } from '../registry.js';
import {
  fileLists,
  fileOf,
  triggerRefsOf,
  type WorkflowFile,
  type WorkflowFileCalled,
  type WorkflowFileCredential,
} from './file.js';

/** One workflow to import. */
export interface WorkflowImportEntry {
  id: string;
  draft: WorkflowSnapshot;
  /** The published definition, when it differs from the draft. */
  live?: WorkflowSnapshot | null | undefined;
  enabled: boolean;
  /** Whether it gets a published version. */
  publish: boolean;
}

/** Workflows to import and what they reference: a workflow file or a space export's workflows. */
export interface WorkflowImportSource {
  workflows: WorkflowImportEntry[];
  credentials: WorkflowFileCredential[];
  /** Records the triggers point at, by the file list their kind names, e.g. `webhooks`. */
  records: Record<string, WorkflowFileRecord[]>;
  /** Call targets outside `workflows`; each must exist in the space. */
  called: WorkflowFileCalled[];
}

/** The rows of the target space an import matches against. */
export interface WorkflowImportSpaceRows {
  credentials: ReadonlyArray<Pick<CredentialRow, 'id' | 'slug' | 'kind'>>;
  /** The environment's records trigger kinds point at, by file list. */
  records: Record<string, ReadonlyArray<{ id: string; slug: string }>>;
  workflows: ReadonlyArray<Pick<WorkflowSummary, 'id' | 'name' | 'slug' | 'trigger'>>;
}

/** What an import creates: a credential, a workflow, or a record of a file list. */
export type WorkflowImportRefKind = 'credential' | 'workflow' | (string & Record<never, never>);

export interface PlanImportOptions {
  typeExists: (typeId: string) => boolean;
  registry: WorkflowRegistry;
  /** The id of a row the import creates; random by default. */
  newId?: ((kind: WorkflowImportRefKind, sourceId: string) => string) | undefined;
}

export interface PlannedWorkflow extends WorkflowImportEntry {
  sourceId: string;
  live: WorkflowSnapshot | null;
  /** A call node lost its target, which is not in the file or the space; imported switched off. */
  missingCallTarget: boolean;
}

/** What an import writes: rows with their new ids, references remapped. */
export interface WorkflowImportPlan {
  /** Empty slots to create. */
  credentials: WorkflowFileCredential[];
  /** Records to create by file list, e.g. incoming endpoints, switched off. */
  records: Record<string, WorkflowFileRecord[]>;
  workflows: PlannedWorkflow[];
  /** File id -> id in the space, per kind. */
  ids: Record<WorkflowImportRefKind, Map<string, string>>;
  notes: string[];
}

/** A workflow file as an import source: one disabled, unpublished workflow. */
export function workflowFileSource(
  file: WorkflowFile,
  registry: WorkflowRegistry,
): WorkflowImportSource {
  return {
    workflows: [{ id: 'workflow', draft: file.workflow, enabled: false, publish: false }],
    credentials: file.credentials,
    records: Object.fromEntries(
      fileLists(registry).map((list) => [list, (file[list] ?? []) as WorkflowFileRecord[]]),
    ),
    called: file.workflows,
  };
}

const snapshotsOf = (entry: WorkflowImportEntry): WorkflowSnapshot[] =>
  entry.live ? [entry.draft, entry.live] : [entry.draft];

/**
 * Matches credentials and the records triggers point at by slug and call targets by slug,
 * then name; creates what is missing and remaps every reference. Only what the workflows use
 * is created; a record id the space already holds is kept.
 */
export function planImport(
  input: WorkflowFile | WorkflowImportSource,
  space: WorkflowImportSpaceRows,
  options: PlanImportOptions,
): WorkflowImportPlan {
  const { registry } = options;
  const source = 'format' in input ? workflowFileSource(input, registry) : input;
  const planning: Planning = {
    newId: options.newId ?? (() => randomUUID()),
    notes: [],
    ids: { credential: new Map(), workflow: new Map() },
  };
  const used = usedRefs(registry, source);
  const credentials = planCredentials(planning, source, space, used.credentials);
  const { records, recordId } = planRecords(planning, registry, source, space, used.records);
  for (const entry of source.workflows) {
    planning.ids.workflow.set(entry.id, planning.newId('workflow', entry.id));
  }

  const remapping: Remapping = {
    registry,
    typeExists: options.typeExists,
    ...planning,
    heldCredentials: new Set(space.credentials.map((row) => row.id)),
    missingNames: matchCallTargets(planning, source, space),
    recordId,
  };
  const taken = space.workflows.map((row) => row.name);
  const workflows = source.workflows.map((entry) => planWorkflow(remapping, entry, taken));

  const { ids, notes } = planning;
  return { credentials, records, workflows, ids, notes: [...new Set(notes)] };
}

/** What every planning step writes to: new ids, the file-to-space id map, notes. */
interface Planning {
  newId: NonNullable<PlanImportOptions['newId']>;
  notes: string[];
  ids: WorkflowImportPlan['ids'];
}

/** Record ids the workflows point at, by file list, and the credential ids they use. */
function usedRefs(
  registry: WorkflowRegistry,
  source: WorkflowImportSource,
): { records: Map<string, Set<string>>; credentials: Set<string> } {
  const snapshots = source.workflows.flatMap(snapshotsOf);
  const records = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const [list, refIds] of triggerRefsOf(registry, snapshot)) {
      records.set(list, new Set([...(records.get(list) ?? []), ...refIds]));
    }
  }
  const credentials = new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.nodes
        .flatMap(workflowNodeIdRefs)
        .flatMap((ref) => (ref.kind === 'credential' && ref.id ? [ref.id] : [])),
    ),
  );
  for (const [list, entries] of Object.entries(source.records)) {
    const reader = fileOf(registry, list);
    for (const record of entries) {
      if (!records.get(list)?.has(record.id)) continue;
      for (const id of reader?.credentials?.(record) ?? []) credentials.add(id);
    }
  }
  return { records, credentials };
}

/** Used credentials matched by slug and kind; the others become empty slots. */
function planCredentials(
  { ids, newId, notes }: Planning,
  source: WorkflowImportSource,
  space: WorkflowImportSpaceRows,
  used: ReadonlySet<string>,
): WorkflowFileCredential[] {
  // Planned rows join the space's, so duplicates in the source resolve to one row.
  const credentialRows = [...space.credentials];
  const credentials: WorkflowFileCredential[] = [];
  for (const credential of source.credentials) {
    if (!used.has(credential.id) || ids.credential.has(credential.id)) continue;
    const found = credentialRows.find((row) => row.slug === credential.slug);
    if (found?.kind === credential.kind) {
      ids.credential.set(credential.id, found.id);
      continue;
    }
    const slug = found
      ? uniqueSlug(
          credential.slug,
          credentialRows.map((row) => row.slug),
        )
      : credential.slug;
    const row = { ...credential, id: newId('credential', credential.id), slug };
    credentials.push(row);
    credentialRows.push(row);
    ids.credential.set(credential.id, row.id);
    notes.push(
      found
        ? `The credential "${credential.slug}" exists here as a different kind; created "${slug}", fill in its secret.`
        : `Created the credential "${credential.name}"; fill in its secret.`,
    );
  }
  return credentials;
}

/** Used records matched by slug; the others are created by their file list's reader. */
function planRecords(
  { ids, newId, notes }: Planning,
  registry: WorkflowRegistry,
  source: WorkflowImportSource,
  space: WorkflowImportSpaceRows,
  used: ReadonlyMap<string, Set<string>>,
) {
  const records: WorkflowImportPlan['records'] = {};
  /** Ids of records the space holds, which a space import's references keep. */
  const held = new Map<string, Set<string>>();
  for (const [list, entries] of Object.entries(source.records)) {
    const reader = fileOf(registry, list);
    if (!reader) continue;
    const listIds = new Map<string, string>();
    ids[list] = listIds;
    const rows = [...(space.records[list] ?? [])];
    held.set(list, new Set(rows.map((row) => row.id)));
    const created: WorkflowFileRecord[] = [];
    for (const entry of entries) {
      if (!used.get(list)?.has(entry.id) || listIds.has(entry.id)) continue;
      const found = rows.find((row) => row.slug === entry.slug);
      if (found) {
        listIds.set(entry.id, found.id);
        continue;
      }
      const { record, note } = reader.create(
        entry,
        newId(list, entry.id),
        (id) => ids.credential.get(id) ?? null,
      );
      created.push(record);
      rows.push(record);
      listIds.set(entry.id, record.id);
      notes.push(note);
    }
    records[list] = created;
  }
  for (const [list, rows] of Object.entries(space.records)) {
    if (!held.has(list)) held.set(list, new Set(rows.map((row) => row.id)));
  }
  /** A record id in the space, from the file's or the one the space already holds. */
  const recordId = (list: string) => (id: string) =>
    ids[list]?.get(id) ?? (held.get(list)?.has(id) ? id : null);
  return { records, recordId };
}

/** Call targets outside the file matched by slug, then name; the rest by file id -> name. */
function matchCallTargets(
  { ids }: Planning,
  source: WorkflowImportSource,
  space: WorkflowImportSpaceRows,
): Map<string, string> {
  const missingNames = new Map<string, string>();
  for (const called of source.called) {
    if (ids.workflow.has(called.id)) continue;
    const found =
      (called.slug && space.workflows.find((row) => row.slug === called.slug)) ||
      space.workflows.find((row) => row.trigger.kind === 'call' && row.name === called.name);
    if (found) ids.workflow.set(called.id, found.id);
    else missingNames.set(called.id, called.name);
  }
  return missingNames;
}

/** What remapping a workflow's references reads. */
interface Remapping extends Planning {
  registry: WorkflowRegistry;
  typeExists: PlanImportOptions['typeExists'];
  /** Credentials the space holds, which a space import's references keep. */
  heldCredentials: ReadonlySet<string>;
  /** Call targets neither in the file nor in the space, by file id. */
  missingNames: ReadonlyMap<string, string>;
  recordId: (list: string) => (id: string) => string | null;
}

/** A workflow under a free name; switched off when a call target is missing. */
function planWorkflow(
  remapping: Remapping,
  entry: WorkflowImportEntry,
  taken: string[],
): PlannedWorkflow {
  const original = entry.draft.name.trim() || 'Imported workflow';
  const name = taken.includes(original) ? copyName(original, taken) : original;
  taken.push(name);
  /** Names of the call targets `remap` could not resolve; null when unnamed. */
  const missing: (string | null)[] = [];
  const draft = remap(remapping, entry.draft, name, missing);
  const live = entry.live
    ? remap(
        remapping,
        entry.live,
        entry.live.name.trim() === original ? name : entry.live.name,
        missing,
      )
    : null;
  const planned = {
    ...entry,
    sourceId: entry.id,
    id: remapping.ids.workflow.get(entry.id) as string,
  };
  if (missing.length === 0) return { ...planned, draft, live, missingCallTarget: false };
  // Kept as a switched-off draft with the target emptied, so the rest can import.
  const target = missing.find((known) => known !== null);
  remapping.notes.push(
    target
      ? `Imported "${name}" switched off and unpublished: the workflow "${target}" it runs is not in this space.`
      : `Imported "${name}" switched off and unpublished: a workflow it runs is not in this space.`,
  );
  return {
    ...planned,
    draft,
    live: null,
    enabled: false,
    publish: false,
    missingCallTarget: true,
  };
}

/** A snapshot with its trigger, abort triggers and nodes pointing at the space's rows. */
function remap(
  remapping: Remapping,
  snapshot: WorkflowSnapshot,
  name: string,
  missing: (string | null)[],
): WorkflowSnapshot {
  const trigger = remapTrigger(remapping, snapshot.trigger);
  const abortTriggers = snapshot.abortTriggers.flatMap((abort) =>
    remapAbortTrigger(remapping, abort),
  );
  const nodes = snapshot.nodes.map((node) =>
    remapNodeIds(node, (ref) => {
      const id =
        remapping.ids[ref.kind]?.get(ref.id as string) ??
        (ref.kind === 'credential' && remapping.heldCredentials.has(ref.id as string)
          ? ref.id
          : null);
      if (!id && ref.kind === 'workflow') {
        missing.push(remapping.missingNames.get(ref.id as string) ?? null);
      }
      if (!id) {
        remapping.notes.push(
          ref.kind === 'credential'
            ? `The node "${node.name || node.key}" needs a credential.`
            : `The node "${node.name || node.key}" needs a workflow to call.`,
        );
      }
      return id;
    }),
  );
  return { ...snapshot, name, trigger, abortTriggers, nodes };
}

function remapTrigger(remapping: Remapping, trigger: WorkflowTrigger): WorkflowTrigger {
  const refs = remapping.registry.trigger(trigger.kind)?.refs;
  if (refs) return refs.remap(trigger, remapping.recordId(refs.file));
  if (trigger.kind === 'event') {
    return { ...trigger, typeIds: keepTypes(remapping, trigger.typeIds ?? []) };
  }
  if (trigger.kind === 'schedule' && trigger.selection) {
    return {
      ...trigger,
      selection: {
        ...trigger.selection,
        typeIds: keepTypes(remapping, trigger.selection.typeIds ?? []),
      },
    };
  }
  return trigger;
}

/** The abort trigger remapped; dropped when its record is not in the file. */
function remapAbortTrigger(
  remapping: Remapping,
  abort: WorkflowAbortTrigger,
): WorkflowAbortTrigger[] {
  const own = remapping.registry.abortTrigger(abort.kind)?.refs;
  if (own) {
    const remapped = own.remap(abort, remapping.recordId(own.file));
    if (own.ids(remapped).length < own.ids(abort).length) {
      remapping.notes.push(`Dropped an abort trigger whose ${own.noun} is not in the file.`);
      return [];
    }
    return [remapped];
  }
  if (abort.kind !== 'event') return [abort];
  return [{ ...abort, typeIds: keepTypes(remapping, abort.typeIds ?? []) }];
}

/** The content types the space has; the others are dropped with a note. */
function keepTypes({ typeExists, notes }: Remapping, typeIds: string[]): string[] {
  for (const typeId of typeIds) {
    if (!typeExists(typeId)) notes.push(`Dropped the unknown content type "${typeId}".`);
  }
  return typeIds.filter(typeExists);
}

/** Appends `-2`, `-3`, ... to a taken slug. */
function uniqueSlug(slug: string, taken: readonly string[]): string {
  for (let n = 2; ; n++) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`;
}
