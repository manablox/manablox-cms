import { RunError, runFailure, runFailureOf } from '@manablox/core';
import { isActiveRunStatus, type WorkflowCallNode } from '../../sdk.js';
import { evaluate } from '../template.js';
import {
  CONTINUED,
  type LogEntry,
  type NodeOutcome,
  PAUSED,
  type WalkerHost,
  type WorkflowCallResult,
} from './types.js';

/** Starts the called workflow; waiting, runs it through or pauses until it ends. */
export async function runCall(
  walk: WalkerHost,
  node: WorkflowCallNode,
  entry: LogEntry,
): Promise<NodeOutcome> {
  try {
    walk.signal.throwIfAborted();
    if (!node.workflowId) {
      throw new RunError(
        'plugins.workflows.call.targetRequired',
        {},
        'No workflow is picked to run',
      );
    }
    if (!walk.env.call) {
      throw new RunError(
        'plugins.workflows.run.callUnsupported',
        {},
        'This engine cannot run other workflows',
      );
    }
    const input: Record<string, unknown> = {};
    for (const row of node.input ?? []) {
      const name = row.name.trim();
      if (name) input[name] = evaluate(row.value, walk.context);
    }
    const result = await walk.env.call({
      workflowId: node.workflowId,
      nodeKey: node.key,
      input,
      wait: node.wait,
      context: walk.context,
    });
    const stopped = walk.whenStopped(entry);
    if (stopped) return stopped;
    if (!node.wait) {
      walk.acted++;
      const output = { runId: result.runId, status: result.status, output: null };
      walk.record(node, null, output);
      walk.log.push(
        entry(
          'ok',
          `Started "${result.workflowName}"`,
          { runId: result.runId, workflowId: node.workflowId },
          output,
        ),
      );
      walk.fire(node.id, 'ok');
      return CONTINUED;
    }
    if (isActiveRunStatus(result.status)) {
      // A pass has no state of its own to resume.
      if (walk.iteration !== null) {
        throw new RunError(
          'plugins.workflows.run.callPausedInLoop',
          { name: result.workflowName },
          `"${result.workflowName}" paused, which cannot be waited for inside a loop; it carries on by itself`,
        );
      }
      walk.log.push(
        entry('waiting', `Waiting for "${result.workflowName}" to finish`, {
          runId: result.runId,
          workflowId: node.workflowId,
        }),
      );
      walk.state.awaiting = { nodeId: node.id, runId: result.runId };
      await walk.pause(null);
      return PAUSED;
    }
    return callEnded(walk, node, entry, result);
  } catch (error) {
    const stopped = walk.whenStopped(entry);
    if (stopped) return stopped;
    const failure = runFailureOf(error);
    walk.log.push(entry('failed', failure));
    return walk.handleFailure(node, failure);
  }
}

/** Picks up after the called run this one paused for. */
export async function settleCall(walk: WalkerHost): Promise<NodeOutcome> {
  const awaiting = walk.state.awaiting as { nodeId: string; runId: string };
  const node = walk.byId.get(awaiting.nodeId);
  const result = await walk.env.callResult?.(awaiting.runId);
  if (result && isActiveRunStatus(result.status)) {
    await walk.pause(null);
    return PAUSED;
  }
  walk.state.awaiting = null;
  if (node?.kind !== 'call') return CONTINUED;
  const entry = walk.entryFor(node);
  if (!result) {
    const failure = runFailure(
      'plugins.workflows.run.calledRunGone',
      {},
      'The called run no longer exists',
    );
    walk.log.push(entry('failed', failure, { runId: awaiting.runId }));
    return walk.handleFailure(node, failure);
  }
  return callEnded(walk, node, entry, result);
}

function callEnded(
  walk: WalkerHost,
  node: WorkflowCallNode,
  entry: LogEntry,
  result: WorkflowCallResult,
): NodeOutcome {
  const detail = { runId: result.runId, workflowId: node.workflowId, status: result.status };
  if (result.status === 'failed' || result.status === 'aborted') {
    const reason = result.error ?? (result.status === 'aborted' ? 'it was aborted' : 'it failed');
    const failure = runFailure(
      'plugins.workflows.run.calledRunFailed',
      { name: result.workflowName, reason },
      `"${result.workflowName}" did not finish: ${reason}`,
    );
    walk.log.push(entry('failed', failure, detail));
    return walk.handleFailure(node, failure, detail);
  }
  walk.acted++;
  const output = { runId: result.runId, status: result.status, output: result.output };
  walk.record(node, null, output);
  walk.log.push(entry('ok', `"${result.workflowName}" finished`, detail, output));
  walk.fire(node.id, 'ok');
  return CONTINUED;
}
