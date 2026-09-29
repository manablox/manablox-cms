import type { ErrorFor } from '@manablox/admin-sdk';
// The package's own entry, so the published file resolves it too.
import type { WorkflowFieldSpec, WorkflowRunAbort } from '@manablox/plugin-workflows/sdk';

/** Tile tones of the editor's trigger and node headers. */
export type WorkflowTone = 'clay' | 'iris' | 'ochre' | 'sand' | 'plain';

/** A placeholder a template may read, with what it holds. */
export interface WorkflowPlaceholderHint {
  path: string;
  hint: string;
  /** Set for a path that comes from another node, so the picker can group them. */
  from?: string;
}

/** A trigger or abort trigger of any kind, as the editor holds it. */
export type WorkflowTriggerValue = { kind: string } & Record<string, unknown>;

/** A dialog asking for what a test run starts with, e.g. a sample call. */
export interface WorkflowSampleProps {
  trigger: WorkflowTriggerValue;
  /** Test-runs the draft with the sample, e.g. `{ payload, headers }`. */
  run: (sample: { payload?: unknown; headers?: Record<string, string> | null }) => void;
  close: () => void;
}

/** What a create action's pane gets in the new workflow dialog. */
export interface WorkflowCreateActionProps {
  spaceId: string;
  /**
   * Designs a workflow from a description (`plugins.workflows.design`), lays it out and shows
   * it below the pane for review; throws what the server refused with.
   */
  design: (input: { prompt: string; providerKind?: string }) => Promise<void>;
  /** Whether a design is shown, to word the button. */
  designed: boolean;
}

/**
 * The props of a contributed trigger kind's form. Components declare these by name: Vue's
 * compiler does not see the module augmentation below, so `AdminSlotProps['workflows:...']`
 * would leave them without runtime props.
 */
export interface WorkflowTriggerFormProps {
  trigger: WorkflowTriggerValue;
  mode: 'trigger' | 'abort' | 'create';
  spaceId: string | null;
  /** The kind's entry of the editor catalogue (`catalog.triggers[kind]`). */
  catalog: unknown;
  readOnly: boolean;
  /** Errors below the trigger, e.g. `errorFor(['webhookId'])`. */
  errorFor: ErrorFor;
  update: (trigger: WorkflowTriggerValue) => void;
}

/** The props of an action's own settings form. */
export interface WorkflowNodeFormProps {
  config: Record<string, unknown>;
  readOnly: boolean;
  hints: WorkflowPlaceholderHint[];
  update: (config: Record<string, unknown>) => void;
}

/** The props of a contributed field kind's control. */
export interface WorkflowFieldControlProps {
  spec: WorkflowFieldSpec;
  value: unknown;
  /** The node's config, for fields that depend on others. */
  config: Record<string, unknown>;
  readOnly: boolean;
  /** The control's id, for its label. */
  id: string;
  update: (value: unknown) => void;
}

declare module '@manablox/admin-plugin' {
  interface AdminSlotProps {
    /**
     * The form of a contributed trigger kind, in the trigger card (`mode: 'trigger'`), the abort
     * triggers card (`'abort'`, the kind's own fields) and the new workflow dialog (`'create'`,
     * what the trigger needs up front).
     */
    'workflows:triggerForm': WorkflowTriggerFormProps;
    /** An action's own settings form in place of the one drawn from its fields, by `action`. */
    'workflows:nodeForm': WorkflowNodeFormProps;
    /** The control of a contributed action field kind, by `kind`; the label is drawn around it. */
    'workflows:fieldControl': WorkflowFieldControlProps;
    /** Other ways to start a workflow in the new workflow dialog, next to building it by hand. */
    'workflows:createActions': WorkflowCreateActionProps;
  }

  interface AdminSlotOptions {
    'workflows:triggerForm': {
      /** The trigger kind the entry draws, as its plugin contributes it on the server. */
      kind: string;
      tone?: WorkflowTone;
      /** A fresh trigger; `preset` is a record to point at, e.g. an endpoint's id. */
      create: (preset: string | null, catalog: unknown) => WorkflowTriggerValue;
      /** A fresh abort trigger's own fields, for kinds that can stop runs. */
      abort?: (preset: string | null, catalog: unknown) => WorkflowTriggerValue;
      /** Whether the new workflow dialog may create the trigger as it stands. */
      ready?: (trigger: WorkflowTriggerValue) => boolean;
      /** The trigger in a few words, e.g. `Orders is called`, for the card and the list. */
      title?: (trigger: WorkflowTriggerValue, catalog: unknown) => string;
      /** What templates may read from a start of the kind. */
      hints?: WorkflowPlaceholderHint[];
      /** The trigger's `filter`, drawn below the form when the kind has one. */
      filter?: { title: string; hint: string; lead: string; field: string };
      /** An abort trigger's `filter` and abort key. */
      abortFilter?: { hint: string; field: string; key: string };
      /** Asks for a test run's start; without it a test run starts with nothing. */
      sample?: () => Promise<{ default: unknown }>;
      /** How runs it started are labelled, e.g. `Webhook call`. */
      runLabel?: string;
      /** Words after the label on a run it started, e.g. `to Orders`, from the run context. */
      startedBy?: (context: Record<string, unknown>) => string | null;
      /** A part of a run's start to show on its own, e.g. the call's payload. */
      startPart?: (context: Record<string, unknown>) => { label: string; path: string } | null;
      /** How an abort of the kind reads, e.g. `by a call to orders`. */
      abortedBy?: (abort: WorkflowRunAbort) => string;
      /**
       * Drops what the kind's catalogue lists after a workflow import, which may have created
       * records, e.g. endpoints.
       */
      imported?: (spaceId: string) => void;
    };
    'workflows:nodeForm': {
      /** The action type the form is for. */
      action: string;
    };
    'workflows:fieldControl': {
      /** The field kind the control draws. */
      kind: string;
    };
    'workflows:createActions': {
      label: string;
      icon: string;
    };
  }
}
