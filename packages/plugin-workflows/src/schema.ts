/**
 * Input schemas for workflow graphs; each parses to its type. A trigger of a kind another
 * plugin contributes is only an envelope here: its kind's `check` reads the rest.
 */

import { CONTENT_EVENTS } from '@manablox/core';
import { z } from 'zod';
import {
  WORKFLOW_ABORT_EVENTS,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_DEFAULT_LOOP_ITEMS,
  WORKFLOW_LOOP_MODES,
  WORKFLOW_MAX_LOOP_ITEMS,
  WORKFLOW_TRIGGER_KINDS,
  type WorkflowAbortTrigger,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRuleSet,
  type WorkflowTrigger,
} from './sdk.js';

const typeIds = z.array(z.string().max(120)).max(200).default([]);
const locales = z.array(z.string().max(10)).max(50).default([]);

export const workflowRuleSetSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z
    .array(
      z.object({
        field: z.string().max(300),
        operator: z.enum(WORKFLOW_CONDITION_OPERATORS),
        value: z.string().max(4000).default(''),
      }),
    )
    .max(50),
}) satisfies z.ZodType<WorkflowRuleSet>;

const selection = z.object({
  typeIds,
  status: z.enum(['any', 'draft', 'published']).default('any'),
  changedWithinHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullable()
    .default(null),
  locale: z.string().max(10).nullable().default(null),
});

const nodeBase = {
  id: z.string().max(64).default(''),
  key: z.string().max(64).default(''),
  name: z.string().max(200).default(''),
  enabled: z.boolean().default(true),
  continueOnError: z.boolean().default(false),
  join: z.enum(['any', 'all']).default('any'),
  ui: z.object({ x: z.number().default(0), y: z.number().default(0) }).default({ x: 0, y: 0 }),
};

/** A contributed kind's name. */
const contributedKind = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9.-]{0,59}$/)
  .refine((kind) => !(WORKFLOW_TRIGGER_KINDS as readonly string[]).includes(kind));

/**
 * The graph schemas, with `ref` validating ids of other records (credentials, workflows):
 * uuids in a space, any short string inside an exported file.
 */
function graphSchemas(ref: z.ZodString) {
  const reference = ref.nullable().default(null);
  const parameters = z
    .array(
      z.object({
        name: z.string().max(60),
        description: z.string().max(500).default(''),
        required: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]);

  const builtin = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('event'),
      events: z.array(z.enum(CONTENT_EVENTS)).max(10),
      typeIds,
      locales,
    }),
    z.object({
      kind: z.literal('schedule'),
      cron: z.string().max(100),
      timezone: z.string().max(60).default('UTC'),
      selection: selection.nullable().default(null),
      perDocument: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal('call'),
      parameters,
      output: z.string().max(4000).default(''),
    }),
    z.object({ kind: z.literal('manual'), parameters }),
  ]);
  const trigger = z
    .union([builtin, z.object({ kind: contributedKind }).catchall(z.unknown())])
    .transform((value) => value as WorkflowTrigger);

  const abortBase = {
    id: z.string().max(64).default(''),
    filter: workflowRuleSetSchema.nullable().default(null),
    match: z
      .object({
        mode: z.enum(['all', 'document', 'key']).default('all'),
        runKey: z.string().max(1000).default(''),
        abortKey: z.string().max(1000).default(''),
      })
      .default({ mode: 'all', runKey: '', abortKey: '' }),
  };

  const abortTrigger = z
    .union([
      z.object({
        ...abortBase,
        kind: z.literal('event'),
        events: z.array(z.enum(WORKFLOW_ABORT_EVENTS)).max(20),
        typeIds,
        locales,
      }),
      z.object({ ...abortBase, kind: contributedKind }).catchall(z.unknown()),
    ])
    .transform((value) => value as WorkflowAbortTrigger);

  // Envelope checks only; the action's own `validate` checks `config`.
  const node = z.discriminatedUnion('kind', [
    z.object({
      ...nodeBase,
      kind: z.literal('action'),
      action: z.string().max(120),
      config: z.record(z.string(), z.unknown()).default({}),
      credentialId: reference,
    }),
    z.object({ ...nodeBase, kind: z.literal('condition'), ...workflowRuleSetSchema.shape }),
    z.object({
      ...nodeBase,
      kind: z.literal('switch'),
      field: z.string().max(300),
      // The node check reports too many cases with its own message.
      cases: z
        .array(
          z.object({
            id: z.string().max(64).default(''),
            label: z.string().max(200).default(''),
            operator: z.enum(WORKFLOW_CONDITION_OPERATORS).default('equals'),
            value: z.string().max(4000).default(''),
          }),
        )
        .max(50),
    }),
    z.object({
      ...nodeBase,
      kind: z.literal('delay'),
      minutes: z
        .number()
        .min(1)
        .max(60 * 24 * 30),
    }),
    z.object({
      ...nodeBase,
      kind: z.literal('loop'),
      mode: z.enum(WORKFLOW_LOOP_MODES).default('items'),
      items: z.string().max(1000).default(''),
      count: z.union([z.string().max(1000), z.number().transform(String)]).default(''),
      until: workflowRuleSetSchema.default({ match: 'all', rules: [] }),
      maxItems: z
        .number()
        .int()
        .min(1)
        .max(WORKFLOW_MAX_LOOP_ITEMS)
        .default(WORKFLOW_DEFAULT_LOOP_ITEMS),
    }),
    z.object({
      ...nodeBase,
      kind: z.literal('call'),
      workflowId: reference,
      input: z
        .array(z.object({ name: z.string().max(60), value: z.string().max(4000).default('') }))
        .max(50)
        .default([]),
      wait: z.boolean().default(true),
    }),
    z.object({
      ...nodeBase,
      kind: z.literal('stop'),
      outcome: z.enum(['succeeded', 'failed']).default('succeeded'),
      message: z.string().max(4000).default(''),
    }),
  ]) satisfies z.ZodType<WorkflowNode>;

  const edge = z.object({
    id: z.string().max(64).default(''),
    from: z.string().max(64),
    fromPort: z.string().max(40),
    to: z.string().max(64),
    guard: workflowRuleSetSchema.nullable().default(null),
  }) satisfies z.ZodType<WorkflowEdge>;

  return {
    name: z.string().max(200),
    description: z.string().max(2000).nullable().optional(),
    trigger,
    // Validation reports more than the most allowed, with its limit.
    abortTriggers: z.array(abortTrigger).max(50).default([]),
    nodes: z.array(node).max(200),
    edges: z.array(edge).max(400),
  };
}

/** A workflow's editable body: name, triggers and graph. */
export const workflowBodyShape = graphSchemas(z.string().uuid());

/** A `WorkflowFile`; ids inside are references within the file, so any string is fine. */
export const workflowFileSchema = z
  .object({
    format: z.literal('manablox.workflow'),
    version: z.number().int().min(1),
    exportedAt: z.string().max(100).optional(),
    workflow: z.object(graphSchemas(z.string().max(64))),
    credentials: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
    workflows: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  })
  // The lists of records trigger kinds carry, e.g. `webhooks`.
  .catchall(z.array(z.record(z.string(), z.unknown())).max(200));
