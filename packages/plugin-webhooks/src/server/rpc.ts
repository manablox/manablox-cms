import {
  type PluginRouterOf,
  type PluginRpcContext,
  type PluginRpcKit,
  payloadOf,
  schemas,
} from '@manablox/api-rpc/plugin';
import { CONTENT_EVENTS, SIGNATURE_ALGORITHMS, SIGNATURE_FORMATS } from '@manablox/core';
import { z } from 'zod';
import { WEBHOOK_AUTH_MODES, WEBHOOK_DIRECTIONS, WEBHOOK_METHODS } from '../sdk.js';
import type { WebhooksServices } from './services/index.js';

const { pagination, spaceItem, spaceScoped, uuid } = schemas;

const auth = z
  .object({
    mode: z.enum(WEBHOOK_AUTH_MODES).default('none'),
    credentialId: uuid.nullable().default(null),
    signatureHeader: z.string().max(120).default('x-manablox-signature'),
    algorithm: z.enum(SIGNATURE_ALGORITHMS).default('sha256'),
    format: z.enum(SIGNATURE_FORMATS).default('prefixed'),
  })
  .default({
    mode: 'none',
    credentialId: null,
    signatureHeader: 'x-manablox-signature',
    algorithm: 'sha256',
    format: 'prefixed',
  });

/** Envelope checks only; `WebhookService` validates per direction (outgoing needs a URL). */
const webhookSchema = spaceScoped.extend({
  direction: z.enum(WEBHOOK_DIRECTIONS),
  name: z.string().max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  url: z.string().max(2000).optional(),
  events: z.array(z.enum(CONTENT_EVENTS)).max(20).optional(),
  headers: z
    .array(z.object({ name: z.string().max(120), value: z.string().max(4000) }))
    .max(30)
    .optional(),
  methods: z.array(z.enum(WEBHOOK_METHODS)).max(5).optional(),
  auth,
  enabled: z.boolean().optional(),
});

/** The webhook service of a procedure's context. */
const service = (context: PluginRpcContext<WebhooksServices>) => context.plugin.services.webhooks;

/** Incoming and outgoing webhooks, at `plugins.webhooks`. The rules are in `WebhookService`. */
export const webhookRpc = ({ scoped }: PluginRpcKit<WebhooksServices>) => ({
  /** A page of the space's webhooks, by direction then name. */
  list: scoped('webhooks:read')
    .input(
      spaceScoped.extend({
        direction: z.enum(WEBHOOK_DIRECTIONS).nullable().default(null),
        pagination: pagination({ limit: 50, max: 200 }),
      }),
    )
    .handler(async ({ input, context }) =>
      service(context).list(context.env, input.direction ?? undefined, input.pagination),
    ),

  get: scoped('webhooks:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => service(context).get(context.env, input.id)),

  create: scoped('webhooks:write')
    .input(webhookSchema)
    .handler(async ({ input, context }) => {
      const data = payloadOf(input);
      return service(context).create(context.env, data);
    }),

  update: scoped('webhooks:write')
    .input(webhookSchema.extend({ id: uuid }))
    .handler(async ({ input, context }) => {
      const { id, ...data } = payloadOf(input);
      return service(context).update(context.env, id, data);
    }),

  setEnabled: scoped('webhooks:write')
    .input(spaceItem.extend({ enabled: z.boolean() }))
    .handler(async ({ input, context }) =>
      service(context).setEnabled(context.env, input.id, input.enabled),
    ),

  delete: scoped('webhooks:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await service(context).delete(context.env, input.id);
      return { ok: true };
    }),

  /** A page of an endpoint's calls, newest first. */
  deliveries: scoped('webhooks:read')
    .input(spaceItem.extend({ pagination: pagination({ limit: 50, max: 200 }) }))
    .handler(async ({ input, context }) =>
      service(context).deliveries(context.env, input.id, input.pagination),
    ),

  /** Sends one logged call again. Outgoing only. */
  retry: scoped('webhooks:write')
    .input(spaceItem.extend({ deliveryId: uuid }))
    .handler(async ({ input, context }) =>
      service(context).retry(context.env, input.id, input.deliveryId),
    ),

  /** Sends a test call. */
  test: scoped('webhooks:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => service(context).test(context.env, input.id)),
});

export type WebhooksRouter = PluginRouterOf<typeof webhookRpc>;
