import type { CredentialKind, ErrorDetail } from '@manablox/core';
import {
  checkRuleSet,
  readRuleSet,
  type WorkflowRuleSet,
  type WorkflowTrigger,
} from '../../sdk.js';
import { placeholders } from '../template.js';

export interface ValidationEnvironment {
  /** Whether a content type id exists in this space or in code. */
  typeExists: (typeId: string) => boolean;
  /** The kind of a credential of this space, or null. */
  credentialKind: (id: string) => CredentialKind | null;
  /** What a trigger kind's `lookup` found for the environment, by kind. */
  triggerData: (kind: string) => unknown;
  /** Ids of records an import creates, by file list (see `WorkflowTriggerRefs.file`). */
  plannedRecords?: ((list: string) => ReadonlySet<string>) | undefined;
  /** The trigger of a workflow of this space, or null. */
  workflowTrigger: (id: string) => WorkflowTrigger | null;
  /** Lets a disabled workflow keep call nodes without a target, as an import leaves them. */
  emptyCallTargets?: boolean | undefined;
}

export type Add = (
  key: ErrorDetail['key'],
  path: (string | number)[],
  params?: Record<string, unknown>,
) => void;

/** A path builder rooted at one field. */
export type At = (...rest: (string | number)[]) => (string | number)[];

/** The node keys `{{ nodes.<key>… }}` placeholders in a template name. */
export function nodeKeysIn(template: string): string[] {
  return placeholders(template).flatMap((path) => {
    const key = nodeKeyOf(path);
    return key ? [key] : [];
  });
}

export const nodeKeyOf = (path: string): string | null =>
  path.startsWith('nodes.') ? (path.split('.')[1] ?? null) : null;

export function validateRules(set: WorkflowRuleSet, at: At, add: Add): WorkflowRuleSet {
  checkRuleSet(set, (key, path, params) => add(key as ErrorDetail['key'], at(...path), params));
  const read = readRuleSet(set as unknown as Record<string, unknown>);
  // Unknown operators are reported above; keep them as sent.
  return {
    match: read.match,
    rules: read.rules.map((rule, i) => ({
      ...rule,
      operator: set.rules[i]?.operator ?? rule.operator,
    })),
  };
}
