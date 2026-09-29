import { DIFF_KINDS, USAGE_METRICS } from '@manablox/services';
import { z } from 'zod';

export const scopeParam = z
  .string()
  .min(1)
  .max(300)
  .describe('`instance`, `group:<id>`, `group:ext:<externalId>` or `space:<id>`.');
export const groupParam = z.string().min(1).max(300).describe('A group id, or `ext:<externalId>`.');
export const settings = z.record(z.string(), z.unknown());
export const scopedSettings = z.object({ scope: z.string(), settings });

export const groupSchema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  name: z.string(),
  spaceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const groupWrite = z.object({
  name: z.string().min(1).max(200),
  externalId: z.string().min(1).max(200).nullable().optional(),
});

export const spaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  machineName: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  defaultLocale: z.string(),
  locales: z.array(z.string()),
  status: z.string().describe('`ready`, `importing` or `failed`.'),
  group: z
    .object({ id: z.string(), externalId: z.string().nullable(), name: z.string() })
    .nullable(),
  hosts: z.array(
    z.object({
      hostname: z.string(),
      locale: z.string().nullable(),
      isPrimary: z.boolean(),
      verified: z.boolean(),
      verificationToken: z
        .string()
        .nullable()
        .describe('The `_manablox.<host>` TXT value while unverified.'),
    }),
  ),
  apiHosts: z
    .array(
      z.object({
        hostname: z.string(),
        verified: z.boolean(),
        verificationToken: z
          .string()
          .nullable()
          .describe('The `_manablox.<host>` TXT value while unverified.'),
        createdAt: z.string(),
      }),
    )
    .describe('Host names the public API answers this space on.'),
  counts: z.object({
    documents: z.number(),
    contentTypes: z.number(),
    members: z.number(),
    assets: z.number(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiHostList = z
  .array(z.string().min(1).max(260))
  .max(100)
  .describe('Host names the public API answers the space on; kept ones keep their verification.');

export const snapshotSchema = z.object({
  id: z
    .string()
    .describe('The creation time as a key-safe stamp, e.g. `2026-09-25T10-15-00-000Z`.'),
  spaceId: z.string(),
  machineName: z.string(),
  name: z.string(),
  createdAt: z.string(),
  trigger: z.enum(['manual', 'scheduled', 'promote']),
  formatVersion: z.number().describe('Version of the space export inside.'),
  size: z.number().describe('Bytes of the compressed export; asset files are not included.'),
  counts: z.object({
    contentTypes: z.number(),
    contents: z.number(),
    assets: z.number(),
    menus: z.number(),
  }),
});
export const snapshotSpace = z.object({ spaceId: z.uuid() });

export const spaceIdParam = z.string().min(1).max(100);
export const environmentParam = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/)
  .max(64)
  .describe('An environment machine name, e.g. `staging`.');
export const environmentMode = z
  .enum(['config', 'full'])
  .describe('`config`: types, templates, menus and what plugins keep; `full` adds content.');
export const environmentSchema = z.object({
  id: z.string(),
  machineName: z.string(),
  name: z.string(),
  kind: z.enum(['production', 'staging']),
  createdFrom: z.string().nullable().describe('The environment it was copied from, by id.'),
  createdMode: z.enum(['config', 'full']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const diffStatus = z.enum(['added', 'changed', 'removed']);
export const environmentDiff = z.object({
  environment: z.string(),
  mode: z.enum(['config', 'full']),
  contentTypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      label: z.string(),
      status: z
        .enum(['added', 'changed', 'removed', 'kept'])
        .describe('`kept`: removed in staging but still used by production documents.'),
      documents: z.number().describe('Production documents of the type.'),
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          status: z.enum(['added', 'changed', 'removed', 'retyped']),
          from: z.string().nullable(),
          to: z.string().nullable(),
          documents: z.number().describe('Production documents holding a value for the field.'),
        }),
      ),
    }),
  ),
  changes: z.array(
    z.object({
      kind: z.string().describe(`One of ${DIFF_KINDS.join(', ')}, or a data provider's key.`),
      added: z.number(),
      changed: z.number(),
      removed: z.number(),
      items: z.array(z.object({ status: diffStatus, id: z.string(), label: z.string() })),
      truncated: z.boolean(),
    }),
  ),
  breaking: z
    .boolean()
    .describe('Config only: removed or retyped fields production documents hold values for.'),
  confirmRequired: z.boolean(),
});

export const locale = z.string().min(2).max(10);
export const stateSchema = z.object({
  status: z.enum(['active', 'readOnly', 'suspended']),
  message: z.string().max(1000).optional(),
});
export const resolvedState = z.object({
  status: z.enum(['active', 'readOnly', 'suspended']),
  scope: z.string().nullable(),
  message: z.string().optional(),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string().describe('`superadmin` or `editor`.'),
  banned: z.boolean(),
  memberships: z.number().describe('Spaces the account is a member of.'),
  lastSignInAt: z
    .string()
    .nullable()
    .describe('Start of the newest stored session; `null` without one.'),
  createdAt: z.string(),
});
export const linkOptions = z.object({
  expiresIn: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 60 * 60)
    .optional()
    .describe('Seconds the link stays valid; 72 hours by default.'),
  sendMail: z
    .boolean()
    .default(false)
    .describe('Also mail a link to the account when mail is configured.'),
});
export const passwordLink = z.object({
  setPasswordLink: z.object({ url: z.string(), expiresAt: z.string() }),
  mailSent: z.boolean().describe('Whether a link was also mailed.'),
});
export const userIdParam = z.string().min(1).max(100);

export const period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('`YYYY-MM`: the month the period starts in.');
const usageLimit = z.object({
  max: z.number(),
  mode: z.enum(['hard', 'soft']),
  thresholds: z.array(z.number()),
});
const usageMetric = z.object({
  counted: z.number().describe('Counted by the CMS; up to about a minute behind.'),
  external: z.number().describe('Reported through `POST /usage/external`.'),
  total: z.number(),
  limit: usageLimit.nullable().describe('The usage limit set at this scope.'),
  state: z
    .enum(['ok', 'warn', 'over', 'blocked'])
    .nullable()
    .describe('`total` against `limit`; `null` without one.'),
});
/** Core metrics, then those of the loaded plugins (`plugins.<id>.<name>`). */
export const usageMetrics = z
  .object(
    Object.fromEntries(USAGE_METRICS.map((metric) => [metric, usageMetric])) as Record<
      (typeof USAGE_METRICS)[number],
      typeof usageMetric
    >,
  )
  .catchall(usageMetric);
