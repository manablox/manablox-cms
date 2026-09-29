import type { FeatureKey } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AnyWorkflowAction } from '../../define/action.js';
import type { WorkflowNode } from '../../sdk.js';
import { workflowKeys } from '../keys.js';
import type { WorkflowRegistry } from '../registry.js';
import { contentCreateAction, contentUpdateAction } from './content.js';
import { crawlAction } from './crawl.js';
import { emailAction } from './email.js';
import { gmailSendAction, mailSendAction } from './gmail.js';
import { httpAction } from './http.js';
import { pushAction } from './push.js';
import { transformAction } from './transform.js';

export * from './content.js';
export * from './crawl.js';
export * from './email.js';
export * from './gmail.js';
export * from './http.js';
export * from './push.js';
export * from './shared.js';
export * from './transform.js';

/** Built-in actions, contributed by the plugin itself; a plugin claiming the same key wins. */
export function builtinActions(): AnyWorkflowAction[] {
  return [
    emailAction,
    pushAction,
    httpAction,
    transformAction,
    crawlAction,
    contentCreateAction,
    contentUpdateAction,
    mailSendAction,
    gmailSendAction,
  ];
}

/** Built-in actions behind a feature flag. */
const ACTION_FEATURES: Record<string, FeatureKey> = {
  http: workflowKeys.features.http,
  'crawl.site': workflowKeys.features.http,
  email: workflowKeys.features.mail,
  'mail.send': workflowKeys.features.mail,
  'gmail.send': workflowKeys.features.mail,
};

/** The flags an action needs: its built-in one, its plugin's and the one it declares. */
export function actionFeatures(registry: WorkflowRegistry, type: string): FeatureKey[] {
  const builtin = ACTION_FEATURES[type];
  const plugin = registry.actionFeature(type);
  const declared = registry.actions.tryGet(type)?.feature;
  return [
    ...(builtin ? [builtin] : []),
    ...(plugin ? [plugin] : []),
    ...(declared ? [declared] : []),
  ];
}

/** Throws `control.feature` when an action is switched off in the space. */
export async function assertActionAllowed(
  manablox: Manablox,
  registry: WorkflowRegistry,
  spaceId: string,
  type: string,
): Promise<void> {
  for (const feature of actionFeatures(registry, type)) {
    await manablox.controls.assertFeature(spaceId, feature);
  }
}

/** Throws `control.feature` for the first enabled action node that is switched off. */
export async function assertActionsAllowed(
  manablox: Manablox,
  registry: WorkflowRegistry,
  spaceId: string,
  nodes: readonly WorkflowNode[],
): Promise<void> {
  const types = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'action' && node.enabled !== false) types.add(node.action);
  }
  for (const type of types) await assertActionAllowed(manablox, registry, spaceId, type);
}
