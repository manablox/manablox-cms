import type { WorkflowTriggerCheck } from '../../define/triggers.js';
import type { WorkflowNode, WorkflowTrigger } from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import {
  type Add,
  type At,
  nodeKeysIn,
  type ValidationEnvironment,
  validateRules,
} from './shared.js';

export { MAX_CALL_PARAMETERS } from '../triggers.js';

/** What a kind's `check` gets, with paths rooted at `at`. */
export function triggerCheck(
  kind: string,
  list: string | undefined,
  env: ValidationEnvironment,
  at: At,
  add: Add,
): WorkflowTriggerCheck {
  return {
    data: env.triggerData(kind),
    planned: (list && env.plannedRecords?.(list)) || new Set(),
    add: (key, path, params) => add(key, at(...path), params),
    typeExists: env.typeExists,
    // An empty rule set means no filter.
    rules: (set, path) =>
      set?.rules?.length ? validateRules(set, (...rest) => at(...path, ...rest), add) : null,
  };
}

/** Checks the trigger through its kind; a kind no configured plugin contributes is refused. */
export function validateTrigger(
  trigger: WorkflowTrigger,
  env: ValidationEnvironment,
  registry: WorkflowRegistry,
  add: Add,
): WorkflowTrigger {
  const kind = registry.trigger(trigger.kind);
  if (!kind) {
    add('plugins.workflows.trigger.kindUnknown', ['trigger', 'kind'], { kind: trigger.kind });
    return trigger;
  }
  return kind.check(
    trigger,
    triggerCheck(kind.kind, kind.refs?.file, env, (...rest) => ['trigger', ...rest], add),
  ) as WorkflowTrigger;
}

/** The output of a called workflow may read any node, since it is rendered at the end. */
export function validateOutput(output: string, nodes: WorkflowNode[], add: Add): void {
  const keys = new Set(nodes.map((node) => node.key));
  for (const key of nodeKeysIn(output)) {
    if (!keys.has(key)) {
      add('plugins.workflows.reference.unknownNode', ['trigger', 'output'], { key });
    }
  }
}
