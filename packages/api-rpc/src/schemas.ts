import { CONTENT_TYPE_KINDS } from '@manablox/core';
import { z } from 'zod';

/** Input primitives shared by every management router. */
export const uuid = z.string().uuid();

/** BCP-47-ish: `en`, `de-AT`. */
export const locale = z.string().min(2).max(10);
export const localeList = z.array(locale).min(1);

/** Lower-case, letter first, then digits, `_` and `-`. Keys the GraphQL schema and space pinning. */
export const machineName = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/)
  .max(64);

export const searchTerm = z.string().max(200);

/** A schedule window end: `null` clears, absent leaves it alone. */
export const scheduleAt = z.coerce.date().nullable().optional();

/** `image/png`, or a family with a trailing slash: `image/`. */
export const mimeTypePattern = z
  .string()
  .regex(/^[a-z0-9-]+\/([a-z0-9.+-]+)?$/)
  .max(100);

/** The nested `pagination` input of every list: `limit`/`offset` with a default and ceiling. */
export function pagination(options: { limit: number; max: number }) {
  return z
    .object({
      limit: z.number().int().min(1).max(options.max).default(options.limit),
      offset: z.number().int().min(0).default(0),
    })
    .default({ limit: options.limit, offset: 0 });
}

/** The space id and environment `scoped()` reads; production when `environment` is absent. */
export const spaceScoped = z.object({ spaceId: uuid, environment: machineName.optional() });

/** The input without the space id and environment `scoped()` read: what a write takes. */
export function payloadOf<T extends { spaceId: string; environment?: string | undefined }>(
  input: T,
): Omit<T, 'spaceId' | 'environment'> {
  const { spaceId: _spaceId, environment: _environment, ...payload } = input;
  return payload;
}

/** One record of a space. */
export const spaceItem = spaceScoped.extend({ id: uuid });

/** A content type in a plan, referencing other types by machine name. */
const planField = z.object({
  name: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  type: z.string().min(1).max(64),
  required: z.boolean().optional(),
  localized: z.boolean().optional(),
  unique: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  admin: z
    .object({
      zone: z.enum(['main', 'sidebar']).optional(),
      width: z.number().int().min(25).max(100).optional(),
      help: z.string().max(500).optional(),
      placeholder: z.string().max(200).optional(),
    })
    .optional(),
});

const planType = z.object({
  name: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  icon: z.string().max(64).optional(),
  kind: z.enum(CONTENT_TYPE_KINDS),
  hasSlug: z.boolean().optional(),
  isPublishable: z.boolean().optional(),
  isVisibleInTree: z.boolean().optional(),
  canBeVisibleInMenu: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  fields: z.array(planField).max(200),
});

/** Types that reference each other by name, as a plugin or an agent proposes them. */
export const contentTypePlan = z.object({ types: z.array(planType).min(1).max(100) });
