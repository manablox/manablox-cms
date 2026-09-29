import { runFailure } from '@manablox/core';
import {
  switchCaseLabel,
  WORKFLOW_SWITCH_DEFAULT_PORT,
  type WorkflowStopNode,
  type WorkflowSwitchNode,
} from '../../sdk.js';
import { evaluateRule } from '../conditions.js';
import { render, resolvePath } from '../template.js';
import { CONTINUED, type LogEntry, type NodeOutcome, type WalkerHost } from './types.js';

/** Leaves by the first case that holds, or by `default`; `{{ nodes.<key>.case }}` names it. */
export function runSwitch(
  walk: WalkerHost,
  node: WorkflowSwitchNode,
  entry: LogEntry,
): NodeOutcome {
  const hit = node.cases.find((option) =>
    evaluateRule(
      { field: node.field, operator: option.operator, value: option.value },
      walk.context,
    ),
  );
  const port = hit?.id ?? WORKFLOW_SWITCH_DEFAULT_PORT;
  const label = hit ? switchCaseLabel(hit) : 'Otherwise';
  walk.record(node, null, { case: port, label, value: resolvePath(walk.context, node.field) });
  walk.log.push(
    entry('ok', hit ? `Taking the case "${label}"` : 'No case holds - taking otherwise', {
      case: port,
    }),
  );
  walk.fire(node.id, port);
  return CONTINUED;
}

/** Ends the whole run, from inside a loop too. */
export function runStop(walk: WalkerHost, node: WorkflowStopNode, entry: LogEntry): NodeOutcome {
  const message = render(node.message, walk.context).trim();
  if (node.outcome === 'failed') {
    const failure = runFailure(
      'plugins.workflows.run.stopped',
      { message: message || 'Stopped as failed' },
      message || 'Stopped as failed',
    );
    walk.log.push(entry('failed', failure));
    return { kind: 'finished', error: failure };
  }
  walk.log.push(entry('ok', message || 'Ended the run here'));
  return { kind: 'finished', error: null };
}
