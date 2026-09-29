import { CONTENT_TYPE_KINDS } from '@manablox/core';
import { z } from 'zod';
import { base, scoped, superadmin } from '../base.js';
import { contentTypePlan, spaceItem, spaceScoped, uuid } from '../schemas.js';

const fieldSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  type: z.string().min(1).max(64),
  settings: z.record(z.string(), z.unknown()).default({}),
  required: z.boolean().default(false),
  localized: z.boolean().default(false),
  unique: z.boolean().default(false),
  readRoles: z.array(z.string().max(64)).max(50).optional(),
  writeRoles: z.array(z.string().max(64)).max(50).optional(),
  admin: z
    .object({
      zone: z.enum(['main', 'sidebar']).default('main'),
      width: z.number().int().min(25).max(100).default(100),
      position: z.number().int().default(0),
      help: z.string().max(500).optional(),
      placeholder: z.string().max(200).optional(),
    })
    .optional(),
});

const contentTypeSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  icon: z.string().max(64).optional(),
  kind: z.enum(CONTENT_TYPE_KINDS).default('content'),
  spaceId: uuid.nullable().default(null),
  hasSlug: z.boolean().optional(),
  isPublishable: z.boolean().optional(),
  isVisibleInTree: z.boolean().optional(),
  canBeVisibleInMenu: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  fields: z.array(fieldSchema).max(200).default([]),
});

export const contentTypeRouter = {
  list: scoped('contentType:read')
    .input(spaceScoped)
    .handler(async ({ context }) => context.contentTypes.list(context.env)),

  get: scoped('contentType:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => context.contentTypes.get(context.env, input.id)),

  create: scoped('contentType:write')
    .input(contentTypeSchema.extend(spaceScoped.shape))
    .handler(async ({ input: { environment: _environment, ...input }, context }) =>
      context.contentTypes.create(input, context.principal.userId, context.env),
    ),

  /**
   * Creates several types that reference each other (or existing types) by machine name.
   * Block types go first; all or nothing. Takes the plan of a design, e.g. the AI plugin's.
   */
  applyPlan: scoped('contentType:write')
    .input(spaceScoped.extend(contentTypePlan.shape))
    .handler(async ({ input, context }) =>
      context.contentTypes.applyPlan(context.env, { types: input.types }, context.principal.userId),
    ),

  update: scoped('contentType:write')
    .input(contentTypeSchema.extend(spaceItem.shape))
    .handler(async ({ input: { environment: _environment, ...input }, context }) =>
      context.contentTypes.update(context.env, input.id, input),
    ),

  delete: scoped('contentType:delete')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.contentTypes.delete(context.env, input.id);
      return { ok: true };
    }),

  /** The field-type catalogue, from the registry so plugin types appear too. */
  fieldTypes: base.handler(async ({ context }) =>
    context.manablox.fieldTypes.all.map((type) => ({
      name: type.name,
      label: type.label,
      icon: type.icon ?? null,
      description: type.description ?? null,
      nested: type.nested ?? false,
      filters: type.filters,
      admin: type.admin,
    })),
  ),

  /** JSON Schema for one field type's settings. */
  fieldTypeSettingsSchema: base
    .input(z.object({ name: z.string() }))
    .handler(async ({ input, context }) => {
      const type = context.manablox.fieldTypes.get(input.name);
      const schema = type.settingsSchema as unknown as { toJSONSchema?: () => unknown };
      return {
        name: type.name,
        jsonSchema: typeof schema.toJSONSchema === 'function' ? schema.toJSONSchema() : null,
      };
    }),

  reload: superadmin.handler(async ({ context }) => {
    await context.contentTypes.reload();
    return { schemaVersion: context.manablox.contentTypes.schemaVersion };
  }),
};
