import {
  type PluginRouterOf,
  type PluginRpcContext,
  type PluginRpcKit,
  payloadOf,
  schemas,
} from '@manablox/api-rpc/plugin';
import { ENVIRONMENT_HEADER } from '@manablox/core';
import { z } from 'zod';
import { workflowBodyShape, workflowFileSchema } from '../schema.js';
import { WORKFLOW_ACTIVE_RUN_STATUSES } from '../sdk.js';
import type { WorkflowsServices } from './services/index.js';

const { machineName, pagination, spaceItem, spaceScoped, uuid } = schemas;

const versionNote = z.string().max(500).nullable().optional();

const workflowSchema = spaceScoped.extend({
  enabled: z.boolean().optional(),
  ...workflowBodyShape,
  /** Also publish the saved draft, so triggers run it. */
  publish: z.boolean().optional(),
  note: versionNote,
});

const abortReason = z.string().max(500).nullable().optional();

/** Who an API abort is recorded as. */
const abortActor = (principal: {
  email: string;
  viaApiKey?: boolean;
  apiKeyName?: string | null;
}) => (principal.viaApiKey ? `API key ${principal.apiKeyName ?? ''}`.trim() : principal.email);

/** The workflow service of a procedure's context. */
const service = (context: PluginRpcContext<WorkflowsServices>) => context.plugin.services.workflows;

/** Workflows, at `plugins.workflows`. The rules are in `WorkflowService`. */
export const workflowRpc = ({ authed, scoped }: PluginRpcKit<WorkflowsServices>) => ({
  /** Events, actions with their forms, operators and credentials (empty without a space). */
  catalog: authed
    .input(
      z.object({
        spaceId: uuid.nullable().default(null),
        environment: machineName.optional(),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).catalog(
        input.spaceId
          ? await context.environments.forRequest(
              input.spaceId,
              input.environment ?? context.headers.get(ENVIRONMENT_HEADER),
              context.principal,
            )
          : null,
      ),
    ),

  /** A page of the space's workflows by name. */
  list: scoped('workflows:read')
    .input(spaceScoped.extend({ pagination: pagination({ limit: 100, max: 500 }) }))
    .handler(async ({ input, context }) => service(context).page(context.env, input.pagination)),

  get: scoped('workflows:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => service(context).get(context.env, input.id)),

  /** A new draft; `publish` makes it live at once. */
  create: scoped('workflows:write')
    .input(workflowSchema)
    .handler(async ({ input, context }) => {
      const { publish, note, ...data } = payloadOf(input);
      return service(context).create(context.env, data, { publish, note });
    }),

  /** Saves the draft; the published version keeps running until `publish`. */
  update: scoped('workflows:write')
    .input(workflowSchema.extend({ id: uuid }))
    .handler(async ({ input, context }) => {
      const { id, publish, note, ...data } = payloadOf(input);
      return service(context).update(context.env, id, data, { publish, note });
    }),

  /** Publishes the draft as the next version, which triggers run from then on. */
  publish: scoped('workflows:write')
    .input(spaceItem.extend({ note: versionNote }))
    .handler(async ({ input, context }) =>
      service(context).publish(context.env, input.id, input.note ?? null),
    ),

  /** A page of published versions, newest first, without their graphs. */
  versions: scoped('workflows:read')
    .input(
      spaceItem.extend({
        pagination: pagination({ limit: 50, max: 200 }),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).versions(context.env, input.id, input.pagination),
    ),

  /** One published version with its graph. */
  version: scoped('workflows:read')
    .input(spaceItem.extend({ version: z.number().int().min(1) }))
    .handler(async ({ input, context }) =>
      service(context).version(context.env, input.id, input.version),
    ),

  /** Copies a version into the draft. */
  restoreVersion: scoped('workflows:write')
    .input(spaceItem.extend({ version: z.number().int().min(1) }))
    .handler(async ({ input, context }) =>
      service(context).restoreVersion(context.env, input.id, input.version),
    ),

  /** Copies a workflow, disabled. */
  duplicate: scoped('workflows:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => service(context).duplicate(context.env, input.id)),

  setEnabled: scoped('workflows:write')
    .input(spaceItem.extend({ enabled: z.boolean() }))
    .handler(async ({ input, context }) =>
      service(context).setEnabled(context.env, input.id, input.enabled),
    ),

  delete: scoped('workflows:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await service(context).delete(context.env, input.id);
      return { ok: true };
    }),

  /** A page of the run history, newest first, without contexts and outputs. */
  runHistory: scoped('workflows:read')
    .input(
      spaceItem.extend({
        status: z
          .array(
            z.enum([...WORKFLOW_ACTIVE_RUN_STATUSES, 'succeeded', 'failed', 'skipped', 'aborted']),
          )
          .max(7)
          .optional(),
        /** Only test runs, or only the others. */
        test: z.boolean().optional(),
        pagination: pagination({ limit: 25, max: 200 }),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).runHistory(
        context.env,
        input.id,
        { status: input.status, test: input.test },
        input.pagination,
      ),
    ),

  /** One run with its step log, and the definition it walks in `definition`. */
  run: scoped('workflows:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => service(context).run(context.env, input.id)),

  /**
   * Test-runs the draft. An event workflow needs `contentId`, a called one takes `input`,
   * one of a contributed kind a sample call in `payload`, e.g. a webhook's.
   */
  runNow: scoped('workflows:write')
    .input(
      spaceItem.extend({
        contentId: uuid.nullable().optional(),
        input: z.record(z.string().max(60), z.unknown()).nullable().optional(),
        payload: z
          .object({
            body: z.unknown().default({}),
            query: z.record(z.string().max(200), z.string().max(4000)).default({}),
            method: z.string().max(10).default('POST'),
          })
          .nullable()
          .optional(),
        headers: z.record(z.string().max(200), z.string().max(4000)).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).runNow(context.env, input.id, {
        contentId: input.contentId ?? null,
        input: input.input ?? null,
        payload: input.payload ?? null,
        headers: input.headers ?? null,
      }),
    ),

  /** Starts the live version of a workflow with a manual trigger, with the values it takes. */
  start: scoped('workflows:write')
    .input(spaceItem.extend({ input: z.record(z.string().max(60), z.unknown()).default({}) }))
    .handler(async ({ input, context }) =>
      service(context).start(context.env, input.id, input.input),
    ),

  /** Stops one queued, running or waiting run. */
  abortRun: scoped('workflows:write')
    .input(spaceItem.extend({ reason: abortReason }))
    .handler(async ({ input, context }) =>
      service(context).abortRun(context.env, input.id, {
        actor: abortActor(context.principal),
        reason: input.reason,
      }),
    ),

  /** Stops every queued, running or waiting run of a workflow. */
  abortRuns: scoped('workflows:write')
    .input(spaceItem.extend({ reason: abortReason }))
    .handler(async ({ input, context }) =>
      service(context).abortRuns(context.env, input.id, {
        actor: abortActor(context.principal),
        reason: input.reason,
      }),
    ),

  /** The draft, or a published `version`, as a portable JSON file. */
  export: scoped('workflows:read')
    .input(spaceItem.extend({ version: z.number().int().min(1).optional() }))
    .handler(async ({ input, context }) =>
      service(context).export(context.env, input.id, input.version ?? null),
    ),

  /** Creates a disabled workflow from an exported file. */
  import: scoped('workflows:write')
    .input(spaceScoped.extend({ file: workflowFileSchema }))
    .handler(async ({ input, context }) => service(context).import(context.env, input.file)),

  /**
   * A validated, unsaved, disabled workflow for `create`, designed by the AI plugin against
   * the space's credentials and what its triggers may name; not found without that plugin.
   */
  design: scoped('workflows:read', { also: ['ai:use'] })
    .input(
      spaceScoped.extend({
        providerKind: z
          .string()
          .regex(/^[a-z0-9][a-z0-9:-]{0,79}$/)
          .optional(),
        model: z.string().max(200).optional(),
        prompt: z.string().min(1).max(12_000),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).design({ ...input, scope: context.env, actorId: context.principal.userId }),
    ),
});

export type WorkflowsRouter = PluginRouterOf<typeof workflowRpc>;
