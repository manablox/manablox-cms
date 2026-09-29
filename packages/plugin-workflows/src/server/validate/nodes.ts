import { randomUUID } from 'node:crypto';
import type { ErrorDetail } from '@manablox/core';
import {
  checkWorkflowNode,
  isWorkflowNodeKind,
  readWorkflowNode,
  type WorkflowActionNode,
  type WorkflowCallNode,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodeOf,
} from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import type { Add, At, ValidationEnvironment } from './shared.js';

const NODE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export function validateNodes(
  nodes: WorkflowNode[],
  env: ValidationEnvironment,
  registry: WorkflowRegistry,
  add: Add,
): WorkflowNode[] {
  const keys = new Set<string>();
  const ids = new Set<string>();

  return nodes.map((node, index) => {
    const at = (...rest: (string | number)[]) => ['nodes', index, ...rest];

    const id = node.id || randomUUID();
    if (ids.has(id)) add('plugins.workflows.node.idDuplicate', at('id'));
    ids.add(id);

    const key = (node.key ?? '').trim();
    if (!key) add('plugins.workflows.node.keyRequired', at('key'));
    else if (!NODE_KEY.test(key)) add('plugins.workflows.node.keyInvalid', at('key'), { key });
    else if (keys.has(key)) add('plugins.workflows.node.keyDuplicate', at('key'), { key });
    keys.add(key);

    const base = {
      id,
      key,
      name: (node.name ?? '').trim(),
      enabled: node.enabled ?? true,
      continueOnError: node.continueOnError ?? false,
      join: node.join === 'all' ? ('all' as const) : ('any' as const),
      ui: {
        x: Number.isFinite(node.ui?.x) ? Math.round(node.ui.x) : 0,
        y: Number.isFinite(node.ui?.y) ? Math.round(node.ui.y) : 0,
      },
    };

    if (!isWorkflowNodeKind(node.kind)) {
      add('plugins.workflows.node.kindUnknown', at('kind'), {
        kind: (node as { kind: string }).kind,
      });
      return node;
    }

    checkWorkflowNode(node, (problem, path, params) =>
      add(problem as ErrorDetail['key'], at(...path), params),
    );
    const read = readWorkflowNode(node.kind, base, node as unknown as Record<string, unknown>);
    const external = EXTERNAL_CHECKS[node.kind] as ExternalCheck<WorkflowNodeKind> | undefined;
    return external ? external(read, { env, registry, at, add }) : read;
  });
}

interface ExternalContext {
  env: ValidationEnvironment;
  registry: WorkflowRegistry;
  at: At;
  add: Add;
}

type ExternalCheck<K extends WorkflowNodeKind> = (
  node: WorkflowNodeOf<K>,
  context: ExternalContext,
) => WorkflowNodeOf<K>;

/** Checks against other records of the space, for the kinds that point at any. */
const EXTERNAL_CHECKS: { [K in WorkflowNodeKind]?: ExternalCheck<K> } = {
  action: (node, { env, registry, at, add }) => ({
    ...node,
    ...validateAction(node, env, registry, at, add),
  }),
  call: (node, { env, at, add }) => ({ ...node, ...validateCall(node, env, at, add) }),
};

function validateAction(
  node: WorkflowActionNode,
  env: ValidationEnvironment,
  registry: WorkflowRegistry,
  at: At,
  add: Add,
): Pick<WorkflowActionNode, 'action' | 'config' | 'credentialId'> {
  const action = registry.actions.tryGet(node.action);
  if (!action) {
    add('plugins.workflows.action.unknown', at('action'), { type: node.action });
    return { action: node.action, config: node.config ?? {}, credentialId: null };
  }

  const credentialId = node.credentialId || null;
  if (credentialId) {
    const kind = env.credentialKind(credentialId);
    if (!kind) add('credential.notFound', at('credentialId'), { id: credentialId });
    else if (action.credential && !action.credential.kinds.includes(kind)) {
      add('plugins.workflows.action.credentialKind', at('credentialId'), { kind });
    }
  } else if (action.credential?.required) {
    add('plugins.workflows.action.credentialRequired', at('credentialId'), { action: action.type });
  }

  // The action's own validation, through the same collector.
  const config = { ...action.defaults(), ...(node.config ?? {}) };
  const checked = action.validate
    ? action.validate(config, (...rest) => at('config', ...rest), add)
    : config;

  return { action: action.type, config: checked as Record<string, unknown>, credentialId };
}

function validateCall(
  node: WorkflowCallNode,
  env: ValidationEnvironment,
  at: At,
  add: Add,
): Pick<WorkflowCallNode, 'workflowId' | 'input' | 'wait'> {
  const { workflowId, input } = node;
  if (!workflowId) {
    if (!env.emptyCallTargets) add('plugins.workflows.call.targetRequired', at('workflowId'));
  } else {
    const trigger = env.workflowTrigger(workflowId);
    if (!trigger)
      add('plugins.workflows.call.targetNotFound', at('workflowId'), { id: workflowId });
    else if (trigger.kind !== 'call')
      add('plugins.workflows.call.targetNotCallable', at('workflowId'));
    else {
      const names = new Set(trigger.parameters.map((parameter) => parameter.name));
      for (const [i, row] of input.entries()) {
        if (!names.has(row.name)) {
          add('plugins.workflows.call.inputUnknown', at('input', i, 'name'), { name: row.name });
        }
      }
      for (const parameter of trigger.parameters) {
        const given = input.find((row) => row.name === parameter.name);
        if (parameter.required && !given?.value.trim()) {
          add('plugins.workflows.call.inputRequired', at('input'), { name: parameter.name });
        }
      }
    }
  }
  return { workflowId, input, wait: node.wait };
}
