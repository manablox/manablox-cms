import { AUDIT_ACTIONS, AUDIT_TARGET_KINDS, isAuditActorKind } from '@manablox/core';
import { z } from 'zod';
import { authed, scoped, superadmin } from '../base.js';
import { pagination, searchTerm, spaceItem, spaceScoped } from '../schemas.js';

/** A core kind or a loaded plugin's. */
const actorKind = z.string().max(200).refine(isAuditActorKind);
/** Plugin kinds `<id>.<entity>` and actions `<id>.<entity>.<verb>`. */
const pluginName = (value: string) => value.length <= 200 && /^[\w.-]+$/.test(value);
const targetKind = z.union([
  z.enum(AUDIT_TARGET_KINDS),
  z.templateLiteral([z.string(), '.', z.string()]).refine(pluginName),
]);
const action = z.union([
  z.enum(AUDIT_ACTIONS),
  z.templateLiteral([z.string(), '.', z.string(), '.', z.string()]).refine(pluginName),
]);

const filterSchema = z.object({
  actorKind: actorKind.optional(),
  actorId: z.string().max(200).optional(),
  actions: z.array(action).max(60).optional(),
  targetKind: targetKind.optional(),
  targetId: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: searchTerm.optional(),
});

const sortSchema = z.object({
  by: z.enum(['at', 'action', 'actorLabel', 'targetKind', 'targetLabel']).default('at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

const paginationSchema = pagination({ limit: 50, max: 200 });

/** The read-only activity log. A space's log needs `audit:read`; the instance-wide view is superadmin only. */
export const auditRouter = {
  /** Filterable actions, actor kinds and target kinds. */
  catalog: authed.handler(async ({ context }) => context.audit.catalog()),

  list: scoped('audit:read')
    .input(
      spaceScoped.extend({
        filter: filterSchema.default({}),
        sort: sortSchema.default({ by: 'at', direction: 'desc' }),
        pagination: paginationSchema,
      }),
    )
    .handler(async ({ input, context }) =>
      context.audit.list(input.spaceId, input.filter, input.sort, input.pagination),
    ),

  /** Every entry, or with `instanceOnly` those outside any space. Superadmin. */
  listInstance: superadmin
    .input(
      z.object({
        instanceOnly: z.boolean().default(false),
        filter: filterSchema.default({}),
        sort: sortSchema.default({ by: 'at', direction: 'desc' }),
        pagination: paginationSchema,
      }),
    )
    .handler(async ({ input, context }) =>
      context.audit.listInstance(
        { ...input.filter, ...(input.instanceOnly ? { spaceId: null } : {}) },
        input.sort,
        input.pagination,
      ),
    ),

  get: scoped('audit:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => context.audit.get(input.spaceId, input.id)),

  /** A page of one target's history in the space, newest first. */
  forTarget: scoped('audit:read')
    .input(
      spaceScoped.extend({
        targetKind,
        targetId: z.string().max(200),
        pagination: paginationSchema,
      }),
    )
    .handler(async ({ input, context }) =>
      context.audit.forTarget(input.spaceId, input.targetKind, input.targetId, input.pagination),
    ),

  /** Verifies every entry's hash in the chain. */
  verify: superadmin.handler(async ({ context }) => context.audit.verify()),
};
