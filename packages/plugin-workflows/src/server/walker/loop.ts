import { RunError, type RunFailure, runFailure, runFailureOf } from '@manablox/core';
import { loopBody, type WorkflowLoopNode, type WorkflowNode } from '../../sdk.js';
import { evaluateCondition } from '../conditions.js';
import { evaluate } from '../template.js';
import {
  ABORTED,
  CONTINUED,
  type LogEntry,
  type NodeOutcome,
  type WalkerHost,
  type WalkState,
} from './types.js';

/**
 * Runs the branch once per pass, each pass on its own state but sharing the run's outputs,
 * then leaves by `done`. A pass goes through an item, counts, or repeats until rules hold.
 */
export async function runLoop(
  walk: WalkerHost,
  node: WorkflowLoopNode,
  entry: LogEntry,
): Promise<NodeOutcome> {
  let plan: LoopPlan;
  try {
    plan = planOf(walk, node);
  } catch (error) {
    const failure = runFailureOf(error);
    walk.log.push(entry('failed', failure));
    return walk.handleFailure(node, failure);
  }
  walk.log.push(entry('ok', plan.message, plan.detail));

  const { context } = walk;
  const body = [...loopBody(walk.graph, node.id)]
    .map((id) => walk.byId.get(id))
    .filter((inner): inner is WorkflowNode => Boolean(inner));
  const inBody = new Set(body);
  const outer = walk.state;
  const saved = {
    item: context.item,
    loop: context.loop ?? null,
    iteration: walk.iteration,
  };
  const results: Record<string, unknown>[] = [];
  let met = false;
  const forget = () => {
    for (const inner of body) {
      delete outer.outputs[inner.key];
      delete context.nodes[inner.key];
    }
  };

  try {
    for (let index = 0; index < plan.passes; index++) {
      if (walk.stopped) return ABORTED;
      walk.signal.throwIfAborted();
      // Clear earlier passes' outputs.
      forget();
      const item = plan.items ? plan.items[index] : index;
      context.item = item;
      context.loop = { key: node.key, index, count: plan.count };
      context.nodes[node.key] = { item, index, count: plan.count };
      walk.iteration = index;

      const pass: WalkState = {
        outputs: outer.outputs,
        fired: new Set(),
        dead: new Set(),
        ready: [],
        done: new Set(),
      };
      walk.state = pass;
      walk.fire(node.id, 'each');

      let failed: RunFailure | null = null;
      while (pass.ready.length && failed === null) {
        const id = pass.ready.shift() as string;
        const inner = walk.byId.get(id);
        if (!inner || pass.done.has(id) || !inBody.has(inner)) continue;
        if (await walk.halted(true)) return ABORTED;
        pass.done.add(id);
        const outcome = await walk.runNode(inner);
        if (outcome.kind === 'aborted' || outcome.kind === 'finished') return outcome;
        if (outcome.kind === 'failed') failed = outcome.error;
      }

      const result: Record<string, unknown> = {};
      for (const inner of body) {
        if (inner.key in context.nodes) result[inner.key] = context.nodes[inner.key];
      }
      if (failed !== null) {
        // `continueOnError` skips the pass instead of failing the run.
        if (!node.continueOnError) {
          return {
            kind: 'failed',
            error: runFailure(
              'plugins.workflows.run.loopItemFailed',
              { item: index + 1, reason: failed.message },
              `Item ${index + 1}: ${failed.message}`,
            ),
          };
        }
        result.error = failed.message;
      }
      results.push(result);
      // Checked with this pass's outputs still in place.
      if (node.mode === 'until' && evaluateCondition(node.until, context)) {
        met = true;
        break;
      }
    }
  } finally {
    walk.state = outer;
    context.item = saved.item;
    context.loop = saved.loop;
    walk.iteration = saved.iteration;
    forget();
  }

  walk.record(node, null, {
    count: results.length,
    results,
    ...(node.mode === 'until' ? { met } : {}),
  });
  walk.fire(node.id, 'done');
  return CONTINUED;
}

/** How many passes a loop makes, and the items it hands them. */
interface LoopPlan {
  passes: number;
  /** One per pass; null hands each pass its index. */
  items: unknown[] | null;
  /** What `loop.count` reads; null while repeating until rules hold. */
  count: number | null;
  message: string;
  detail: Record<string, unknown>;
}

function planOf(walk: WalkerHost, node: WorkflowLoopNode): LoopPlan {
  const max = Math.max(1, node.maxItems || 1);
  if (node.mode === 'until') {
    return {
      passes: max,
      items: null,
      count: null,
      message: `Repeating until the rules hold, at most ${max} ${max === 1 ? 'time' : 'times'}`,
      detail: { max },
    };
  }
  if (node.mode === 'count') {
    const wanted = timesOf(walk, node);
    const passes = Math.min(wanted, max);
    return {
      passes,
      items: null,
      count: passes,
      message:
        wanted > passes
          ? `Repeating ${passes} of ${wanted} times`
          : `Repeating ${passes} ${passes === 1 ? 'time' : 'times'}`,
      detail: { count: passes, total: wanted },
    };
  }
  const list = itemsOf(walk, node);
  const items = list.slice(0, max);
  return {
    passes: items.length,
    items,
    count: items.length,
    message:
      list.length > items.length
        ? `Going through the first ${items.length} of ${list.length} items`
        : `Going through ${items.length} ${items.length === 1 ? 'item' : 'items'}`,
    detail: { count: items.length, total: list.length },
  };
}

/** A count loop's number of passes: a whole number from 0, or a placeholder for one. */
function timesOf(walk: WalkerHost, node: WorkflowLoopNode): number {
  const template = (node.count ?? '').trim();
  const value = evaluate(template, walk.context);
  const times = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (String(value ?? '').trim() === '' || !Number.isInteger(times) || times < 0) {
    throw new RunError(
      'plugins.workflows.run.loopCountInvalid',
      { count: String(value ?? '') },
      `"${String(value ?? '')}" is not a number of times to repeat`,
    );
  }
  return times;
}

/** The loop's placeholder value, or else the first list among its inputs. */
function itemsOf(walk: WalkerHost, node: WorkflowLoopNode): unknown[] {
  const template = (node.items ?? '').trim();
  if (template) {
    const list = asList(evaluate(template, walk.context));
    if (!list) {
      throw new RunError(
        'plugins.workflows.run.loopNotList',
        { template },
        `"${template}" is not a list`,
      );
    }
    return list;
  }
  for (const value of Object.values(walk.inputsOf(node))) {
    const list = asList(value);
    if (list) return list;
  }
  throw new RunError(
    'plugins.workflows.run.loopNoList',
    {},
    'The previous node produced no list to go through',
  );
}

/** A list, a JSON list string, or the first list among an object's values. */
function asList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[')) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) if (Array.isArray(entry)) return entry;
  }
  return null;
}
