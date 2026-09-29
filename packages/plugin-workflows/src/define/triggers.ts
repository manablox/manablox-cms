/**
 * Trigger and abort trigger kinds other plugins contribute (`triggers`, `abortTriggers`), and
 * what the workflows plugin reads of them: checks, starts, the editor's catalogue, the AI
 * designer and workflow files. The built-in kinds go through the same contract.
 */

import type { AnyLimitKey, ErrorDetail, Scope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { WorkflowAbortTrigger, WorkflowAbortTriggerBase } from '../sdk/abort.js';
import type { WorkflowTriggerSpec } from '../sdk/node-spec.js';
import type { WorkflowRuleSet, WorkflowTrigger } from '../sdk/workflow.js';

/** Where a kind looks things up: a space's environment. */
export interface WorkflowTriggerContext {
  manablox: Manablox;
  /** Bound to the operation's transaction when it has one. */
  repos: Repositories;
  scope: Scope;
}

/** A workflow of the environment without its graph. */
export interface WorkflowTriggerCatalogWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
}

/** What a kind's `catalog` gets besides the environment: what the catalogue read already. */
export interface WorkflowTriggerCatalogContext<D = unknown> extends WorkflowTriggerContext {
  /** What the kind's `lookup` found for the environment; undefined without one. */
  data: D | undefined;
  /** The environment's workflows. */
  workflows: readonly WorkflowTriggerCatalogWorkflow[];
}

/** What a kind's `check` gets besides the trigger. */
export interface WorkflowTriggerCheck<D = unknown> {
  /** What the kind's `lookup` (or `planned`) found for the workflow's environment. */
  data: D;
  /** Ids of the kind's records (see `refs`) an import creates alongside; they count as there. */
  planned: ReadonlySet<string>;
  /** Reports a problem at a path below the trigger, e.g. `['webhookId']`. */
  add(key: ErrorDetail['key'], at: (string | number)[], params?: Record<string, unknown>): void;
  /** Whether a content type id exists in the workflow's space or in code. */
  typeExists(typeId: string): boolean;
  /** A rule set as the editor submits it, checked and normalised; `null` for no rules. */
  rules(set: WorkflowRuleSet | null | undefined, at: (string | number)[]): WorkflowRuleSet | null;
}

/**
 * Records a trigger points at, such as incoming endpoints: counted per record, carried by
 * workflow files next to the workflow and matched by slug when one is imported.
 */
export interface WorkflowTriggerRefs<T> {
  /** The file's list of them, e.g. `webhooks`; abort kinds naming the same list share it. */
  file: string;
  /** What one is called in import notes, e.g. `webhook`. */
  noun: string;
  /** Ids of the records the trigger points at. */
  ids(trigger: T): string[];
  /** The trigger with each id replaced; `id` answers `null` for one that is not there. */
  remap(trigger: T, id: (id: string) => string | null): T;
}

/** A record a workflow file carries, matched by `slug` on import. */
export interface WorkflowFileRecord {
  id: string;
  name: string;
  slug: string;
  [field: string]: unknown;
}

/** How a trigger kind's records travel in workflow files. */
export interface WorkflowTriggerFile {
  /** The records with these ids as file entries, without secrets. */
  export(context: WorkflowTriggerContext, ids: string[]): Promise<WorkflowFileRecord[]>;
  /** Entries from a file's loose JSON; an entry that cannot be read safely is left out. */
  read(value: unknown): WorkflowFileRecord[];
  /** Vault entries an entry uses, by their ids in the file. */
  credentials?(record: WorkflowFileRecord): string[];
  /** The environment's records an entry may match, by slug. */
  existing(context: WorkflowTriggerContext): Promise<Array<{ id: string; slug: string }>>;
  /**
   * The record to create for an entry the space lacks, under `id`, with its vault entries
   * mapped by `credential`; `note` tells the importer what happened.
   */
  create(
    record: WorkflowFileRecord,
    id: string,
    credential: (id: string) => string | null,
  ): { record: WorkflowFileRecord; note: string };
  /** Writes the records to create, in the import's transaction. */
  write(
    context: WorkflowTriggerContext & { via: string },
    records: WorkflowFileRecord[],
  ): Promise<void>;
  /** The count limit records the import creates count against. */
  limit?: AnyLimitKey;
  /**
   * The space export section holding the records, e.g. a data provider's kind; a space import
   * reads the file's entries from it. The file list's name by default.
   */
  section?: string;
}

/** What the AI designer resolves a trigger's names against. */
export interface WorkflowTriggerDesign {
  /** The kind's `catalog` entry for the space, e.g. its endpoints. */
  catalog: unknown;
  /** A content type the model names, as its id; reports the problem when there is none. */
  typeId(name: unknown): string | null;
}

/** A start `runTrigger` hands to the engine. */
export interface WorkflowTriggerStart {
  /** The record that fired, e.g. the incoming endpoint; its environment's workflows run. */
  source: { id: string; spaceId: string; environmentId: string };
  /** The run context's `event`, e.g. `webhook`; the kind's name when absent. */
  event?: string | undefined;
  /** What an abort records as its event, e.g. the endpoint's slug. */
  label?: string | undefined;
  /** Run context entries, e.g. `{ webhook, payload, headers }`. */
  context: Record<string, unknown>;
}

/** What a start did: runs started and runs aborted, aborts first. */
export interface WorkflowTriggerOutcome {
  runIds: string[];
  abortedRunIds: string[];
}

/**
 * A trigger kind. `T` is the stored trigger and `D` what `lookup` loads for checks. Contributed
 * kinds start through `runTrigger`, which the contributing plugin calls with the workflows
 * plugin's `engine` (`plugins.get('workflows')`).
 */
export interface WorkflowTriggerKindDefinition<T extends { kind: string } = never, D = unknown> {
  kind: T['kind'];
  /** Label, hint, run context entries and the AI designer's view of the kind. */
  spec: WorkflowTriggerSpec;
  /** What `check` needs of the workflow's environment, loaded once per save or import. */
  lookup?(context: WorkflowTriggerContext): Promise<D>;
  /**
   * The same from a code resource sync's plan, whose records may not be written yet; `part`
   * is another resource kind's plan.
   */
  planned?(part: <P>(kind: string) => P | undefined): D;
  /** The trigger as submitted, normalised; problems through `check.add`. */
  check(trigger: T, check: WorkflowTriggerCheck<D>): T;
  /** Whether a `runTrigger` start of `source` concerns a live workflow's trigger. */
  matches?(trigger: T, source: string): boolean;
  /** Run context entries of a test run; a stand-in start unless `sample` holds one. */
  sample?(trigger: T, sample: Record<string, unknown>): Record<string, unknown>;
  /** Records the trigger points at. */
  refs?: WorkflowTriggerRefs<T>;
  /** How those records travel in workflow files; `refs.file` names the list. */
  file?: WorkflowTriggerFile;
  /**
   * The editor catalogue's entry for the kind, e.g. the endpoints a trigger may name; `data`
   * and `workflows` save reading them again.
   */
  catalog?(context: WorkflowTriggerCatalogContext<D>): Promise<unknown>;
  /** The AI designer's side. */
  design?: {
    /** Lines about what the space offers the kind, from its `catalog` entry. */
    prompt?(catalog: unknown): string[];
    /** The trigger from the model's JSON, names resolved; problems in the model's terms. */
    read(raw: Record<string, unknown>, design: WorkflowTriggerDesign, problems: string[]): T;
  };
}

/** An abort trigger kind; label and design come from the trigger kind of the same name. */
export interface WorkflowAbortTriggerKindDefinition<
  T extends WorkflowAbortTriggerBase & { kind: string } = never,
  D = unknown,
> {
  kind: T['kind'];
  /** See the trigger kind's; its data serves both when they share a kind. */
  lookup?(context: WorkflowTriggerContext): Promise<D>;
  planned?(part: <P>(kind: string) => P | undefined): D;
  /** The kind's own fields as submitted, normalised; `id`, `filter` and `match` are checked. */
  check(trigger: T, check: WorkflowTriggerCheck<D>): Omit<T, 'id' | 'filter' | 'match'>;
  /** Whether the trigger is about a document, so it may abort the runs about the same one. */
  document?(trigger: T): boolean;
  /** Whether a `runTrigger` start of `source` concerns the abort trigger. */
  matches?(trigger: T, source: string): boolean;
  refs?: WorkflowTriggerRefs<T>;
  design?: {
    /** The kind's own fields from the model's JSON. */
    read(
      raw: Record<string, unknown>,
      design: WorkflowTriggerDesign,
      problems: string[],
    ): Omit<T, 'id' | 'filter' | 'match'>;
  };
}

// biome-ignore lint/suspicious/noExplicitAny: a registry holds kinds of every shape
export type AnyWorkflowTriggerKind = WorkflowTriggerKindDefinition<any, any>;
// biome-ignore lint/suspicious/noExplicitAny: a registry holds kinds of every shape
export type AnyWorkflowAbortTriggerKind = WorkflowAbortTriggerKindDefinition<any, any>;

/** Types a trigger kind. */
export function defineWorkflowTrigger<T extends { kind: string }, D = unknown>(
  kind: WorkflowTriggerKindDefinition<T, D>,
): WorkflowTriggerKindDefinition<T, D> {
  return kind;
}

/** Types an abort trigger kind. */
export function defineWorkflowAbortTrigger<
  T extends WorkflowAbortTriggerBase & { kind: string },
  D = unknown,
>(kind: WorkflowAbortTriggerKindDefinition<T, D>): WorkflowAbortTriggerKindDefinition<T, D> {
  return kind;
}

/** A field kind of action forms; the contributing plugin draws it in `workflows:fieldControl`. */
export interface WorkflowFieldKindDefinition {
  kind: string;
  description?: string;
}

/** A paragraph the AI designer adds to its prompt, e.g. how to use a contributed action. */
export interface WorkflowDesignHint {
  /** Placed with the placeholders (`placeholders`) or after the actions (`actions`). */
  section: 'placeholders' | 'actions';
  text: string;
}
