import type { CredentialSecret } from '@manablox/core';
import { ManabloxError, RunError, runFailure, runFailureOf } from '@manablox/core';
import type { AnyWorkflowAction, WorkflowActionContext } from '../../define/action.js';
import type { WorkflowActionNode } from '../../sdk.js';
import { assertActionAllowed } from '../actions/index.js';
import { render, renderJson, resolvePath } from '../template.js';
import { CONTINUED, type LogEntry, type NodeOutcome, PAUSED, type WalkerHost } from './types.js';

export async function runAction(
  walk: WalkerHost,
  node: WorkflowActionNode,
  entry: LogEntry,
): Promise<NodeOutcome> {
  const action = walk.env.registry.actions.tryGet(node.action);
  if (!action) {
    const failure = runFailure(
      'plugins.workflows.run.actionMissing',
      { action: node.action },
      `No action named "${node.action}" is installed`,
    );
    walk.log.push(entry('failed', failure));
    return walk.handleFailure(node, failure);
  }

  try {
    walk.signal.throwIfAborted();
    await assertActionAllowed(walk.manablox, walk.env.registry, walk.workflow.spaceId, node.action);
    const credential = await credentialFor(walk, node, action);
    const result = await action.execute(contextFor(walk, node, credential));

    if (result.kind === 'stop') {
      walk.log.push(entry('stopped', result.message));
      walk.killOutgoing(node.id);
      return CONTINUED;
    }
    if (result.kind === 'wait') {
      if (walk.iteration !== null) {
        throw new RunError(
          'plugins.workflows.run.waitInLoop',
          {},
          'An action cannot wait inside a loop',
        );
      }
      // Behaves like a delay node.
      const resumeAt = new Date(walk.env.now().getTime() + result.minutes * 60_000);
      walk.log.push(
        entry('waiting', `Waiting until ${resumeAt.toISOString()}`, {
          resumeAt: resumeAt.toISOString(),
        }),
      );
      walk.fire(node.id, 'ok');
      await walk.pause(resumeAt);
      return PAUSED;
    }

    walk.acted++;
    walk.record(node, action, result.output);
    walk.log.push(entry('ok', result.message ?? null, result.detail ?? null, result.output));
    walk.fire(node.id, result.port ?? 'ok');
    return CONTINUED;
  } catch (error) {
    const stopped = walk.whenStopped(entry);
    if (stopped) return stopped;
    const failure = runFailureOf(error);
    const detail = (error as { detail?: Record<string, unknown> }).detail ?? null;
    walk.log.push(entry('failed', failure, detail));
    walk.manablox.logger.warn(
      { workflowId: walk.workflow.id, runId: walk.run.id, nodeKey: node.key, err: error },
      'workflow node failed',
    );
    return walk.handleFailure(node, failure, detail);
  }
}

/** What an action is handed. */
function contextFor(
  walk: WalkerHost,
  node: WorkflowActionNode,
  credential: CredentialSecret | null,
): WorkflowActionContext {
  const { context, env, manablox, workflow } = walk;
  return {
    config: node.config,
    node,
    run: context,
    inputs: walk.inputsOf(node),
    workflow: {
      id: workflow.id,
      name: workflow.name,
      spaceId: workflow.spaceId,
      environmentId: workflow.environmentId,
    },
    render: (template: string) => render(template, context),
    renderJson: (template: string) => renderJson(template, context),
    resolve: (path: string) => resolvePath(context, path),
    fetch: env.fetch,
    credential,
    secret: (value: string) => {
      if (value) walk.secrets.add(value);
    },
    logger: manablox.logger,
    manablox,
    services: env.services,
    signal: walk.signal,
    adminUrl: env.adminUrl,
  };
}

async function credentialFor(
  walk: WalkerHost,
  node: WorkflowActionNode,
  action: AnyWorkflowAction,
): Promise<CredentialSecret | null> {
  if (!node.credentialId) {
    if (action.credential?.required) {
      throw new ManabloxError('plugins.workflows.action.credentialRequired');
    }
    return null;
  }
  if (!walk.env.credentials) throw new ManabloxError('credential.notFound');

  const credential = await walk.env.credentials.resolve(walk.workflow.spaceId, node.credentialId);
  if (action.credential && !action.credential.kinds.includes(credential.kind)) {
    throw new ManabloxError('plugins.workflows.action.credentialKind');
  }
  // Registered before running so a failure cannot log the secret.
  for (const value of Object.values(credential.data)) if (value) walk.secrets.add(value);
  return credential;
}
