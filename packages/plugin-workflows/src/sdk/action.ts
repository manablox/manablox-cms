/** Browser-safe action metadata; the runtime half is in `../define/action.ts`. */

import type { CredentialKind, FeatureKey } from '@manablox/core';
import type { WorkflowOutputPath, WorkflowPortSpec } from './workflow.js';

/** The palette's built-in groups; an action may name a group of its own with `groupLabel`. */
export const WORKFLOW_ACTION_GROUPS = ['notify', 'data', 'content', 'integration'] as const;
export type WorkflowActionGroup = (typeof WORKFLOW_ACTION_GROUPS)[number];

export const WORKFLOW_ACTION_GROUP_LABELS: Record<WorkflowActionGroup, string> = {
  notify: 'Tell someone',
  data: 'Fetch and shape data',
  content: 'Content',
  integration: 'Integrations',
};

/** How a config field is edited, so any action gets a form without its own component. */
export const WORKFLOW_FIELD_KINDS = [
  'text',
  'password',
  'template',
  'templateArea',
  'textarea',
  'number',
  'select',
  'multiselect',
  'switch',
  'keyValue',
  'stringList',
  'rules',
  'json',
  'contentType',
  'role',
  'locale',
  'user',
] as const;

/**
 * Field kinds other plugins contribute to the `fieldKinds` extension point, by name; the
 * contributing plugin adds its own and fills the admin's `workflows:fieldControl` slot:
 *
 * ```ts
 * declare module '@manablox/plugin-workflows/define' {
 *   interface WorkflowFieldKinds { aiProvider: true }
 * }
 * ```
 *
 * The main entry, `/define` and `/sdk` all export these interfaces; augment one that the file
 * imports, since TypeScript only merges into a module the program loads.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by plugin packages
export interface WorkflowFieldKinds {}

export type WorkflowFieldKind = (typeof WORKFLOW_FIELD_KINDS)[number] | keyof WorkflowFieldKinds;

export interface WorkflowFieldOption {
  value: string;
  label: string;
  hint?: string;
}

export interface WorkflowFieldSpec {
  /** The key in the node's `config`. */
  name: string;
  label: string;
  kind: WorkflowFieldKind;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  options?: WorkflowFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  /** Half-width fields pair up on one row of the inspector. */
  width?: 'full' | 'half';
  /** Only shown while another field of the same action holds one of these values. */
  showWhen?: { field: string; equals: Array<string | number | boolean> };
}

/** An action as the catalogue serves it. */
export interface WorkflowActionMeta {
  /** The registry key stored on the node: `http`, `ai.generate`, `crawl.site`. */
  type: string;
  label: string;
  description: string;
  /** An icon name the admin's `Icon` component knows. */
  icon: string;
  /** Tile tone: `cyan`, `violet`, `pink`, `amber`, `plain`. */
  tone: string;
  /** A built-in group, or one of the action's own, named by `groupLabel`. */
  group: WorkflowActionGroup | (string & Record<never, never>);
  /** The palette heading of a group that is not built in. */
  groupLabel?: string | undefined;
  /**
   * A flag the action needs besides its plugin's, e.g. a feature of the plugin that adds it;
   * switched off, the node is locked like a built-in action behind a flag.
   */
  feature?: FeatureKey | undefined;
  /** Expected input. Advisory: editor only. */
  inputs: WorkflowPortSpec[];
  /** Ports beyond the `ok` / `error` every action has. */
  ports: WorkflowPortSpec[];
  /** What leaves by `ok`. */
  output: WorkflowPortSpec;
  /** The paths the data picker offers under `nodes.<key>`. */
  outputPaths: WorkflowOutputPath[];
  fields: WorkflowFieldSpec[];
  /** A fresh config, from the definition's `defaults()`. */
  defaults: Record<string, unknown>;
  credential: { kinds: CredentialKind[]; required: boolean } | null;
  /** False when this instance cannot run it (no mailer, no AI provider). */
  available: boolean;
  /** Why not, when it is not. */
  unavailable: string | null;
}

/** Every port an action node offers, the two built-in ones first. */
export function actionPorts(
  meta: Pick<WorkflowActionMeta, 'output' | 'ports'>,
): WorkflowPortSpec[] {
  return [
    { name: 'ok', label: 'Succeeded', type: meta.output.type },
    ...meta.ports,
    { name: 'error', label: 'Failed', type: 'json' },
  ];
}
