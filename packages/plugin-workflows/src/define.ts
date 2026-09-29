/**
 * `@manablox/plugin-workflows/define`: what a config file or another plugin needs to declare
 * workflows and to extend them, safe to load at config time: `defineWorkflow`,
 * `defineWorkflowAction`, the trigger kind contract and the types of the plugin's extension
 * points (`contributions: { workflows: { actions, triggers, abortTriggers, fieldKinds,
 * designHints } }`).
 */
import type { AnyWorkflowAction } from './define/action.js';
import type {
  AnyWorkflowAbortTriggerKind,
  AnyWorkflowTriggerKind,
  WorkflowDesignHint,
  WorkflowFieldKindDefinition,
} from './define/triggers.js';

declare module '@manablox/core' {
  /** The workflows plugin's extension points. */
  interface PluginContributions {
    workflows: {
      /** Actions the editor offers as nodes; each carries its own form. */
      actions: AnyWorkflowAction;
      /** Kinds of what starts a workflow. */
      triggers: AnyWorkflowTriggerKind;
      /** Kinds of what stops a workflow's active runs. */
      abortTriggers: AnyWorkflowAbortTriggerKind;
      /** Field kinds action forms may use beyond the built-in ones. */
      fieldKinds: WorkflowFieldKindDefinition;
      /** Paragraphs for the AI designer's prompt. */
      designHints: WorkflowDesignHint;
    };
  }
}

export * from './define/action.js';
export * from './define/triggers.js';
export * from './define/workflow.js';
export * from './sdk.js';
