import { randomUUID } from 'node:crypto';
import type { WorkflowAbortMatch, WorkflowAbortTrigger, WorkflowNode } from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import {
  type Add,
  type At,
  nodeKeysIn,
  type ValidationEnvironment,
  validateRules,
} from './shared.js';
import { triggerCheck } from './trigger.js';

export const MAX_ABORT_TRIGGERS = 20;

export function validateAbortTriggers(
  triggers: WorkflowAbortTrigger[],
  nodes: WorkflowNode[],
  env: ValidationEnvironment,
  registry: WorkflowRegistry,
  add: Add,
): WorkflowAbortTrigger[] {
  if (triggers.length > MAX_ABORT_TRIGGERS) {
    add('plugins.workflows.abort.tooMany', ['abortTriggers'], { max: MAX_ABORT_TRIGGERS });
  }
  const keys = new Set(nodes.map((node) => node.key));
  const ids = new Set<string>();

  return triggers.map((trigger, index) => {
    const at = (...rest: (string | number)[]) => ['abortTriggers', index, ...rest];
    let id = trigger.id || randomUUID();
    if (ids.has(id)) id = randomUUID();
    ids.add(id);
    const filter = trigger.filter?.rules?.length
      ? validateRules(trigger.filter, (...rest) => at('filter', ...rest), add)
      : null;

    const kind = registry.abortTrigger(trigger.kind);
    if (!kind) {
      add('plugins.workflows.abort.kindUnknown', at('kind'), { kind: trigger.kind });
      return { ...trigger, id, filter };
    }
    const own = kind.check(trigger, triggerCheck(kind.kind, kind.refs?.file, env, at, add));
    const match = validateAbortMatch(
      trigger.match,
      kind.document?.(trigger) ?? false,
      keys,
      at,
      add,
    );
    return { ...own, id, filter, match } as WorkflowAbortTrigger;
  });
}

function validateAbortMatch(
  match: Partial<WorkflowAbortMatch> | null | undefined,
  aboutContent: boolean,
  keys: Set<string>,
  at: At,
  add: Add,
): WorkflowAbortMatch {
  const mode = match?.mode === 'document' || match?.mode === 'key' ? match.mode : 'all';
  const runKey = (match?.runKey ?? '').trim();
  const abortKey = (match?.abortKey ?? '').trim();
  if (mode === 'document' && !aboutContent) {
    add('plugins.workflows.abort.documentNeedsContent', at('match', 'mode'));
  }
  if (mode === 'key') {
    if (!runKey) add('plugins.workflows.abort.keyRequired', at('match', 'runKey'));
    if (!abortKey) add('plugins.workflows.abort.keyRequired', at('match', 'abortKey'));
    for (const key of nodeKeysIn(runKey)) {
      if (!keys.has(key)) {
        add('plugins.workflows.reference.unknownNode', at('match', 'runKey'), { key });
      }
    }
  }
  return { mode, runKey: mode === 'key' ? runKey : '', abortKey: mode === 'key' ? abortKey : '' };
}
