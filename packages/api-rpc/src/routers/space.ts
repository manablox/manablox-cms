import { actorRoles } from '@manablox/auth';
import { SPACE_BLOCK_IDS, SPACE_TEMPLATE_IDS } from '@manablox/core';
import {
  applySpaceStarter,
  CONFIG_KINDS,
  SELECTABLE_SECTIONS,
  SPACE_EXPORT_SECTIONS,
} from '@manablox/services';
import { z } from 'zod';
import { authed, base, scoped, superadminWrite } from '../base.js';
import {
  contentTypePlan,
  locale,
  localeList,
  machineName,
  mimeTypePattern,
  searchTerm,
  spaceScoped,
  uuid,
} from '../schemas.js';

/** Sections to export or import, core's or data providers' kinds; all when absent. */
const exportSections = z
  .array(z.union([z.enum(SPACE_EXPORT_SECTIONS), z.string().min(1).max(100)]))
  .min(1);

/** A core section with per-entry selection, or a data provider's kind (`<plugin id>.<name>`). */
const pickableSection = z.union([
  z.enum(SELECTABLE_SECTIONS),
  z.string().regex(/^[a-z][a-z0-9-]*\.[\w-]+$/),
]);

/** Transfer filters: entries by id, documents by type, locale and status. Omitted means all. */
const transferSelection = z.object({
  sections: exportSections.optional(),
  ids: z.record(pickableSection, z.array(uuid)).optional(),
  contents: z
    .object({
      typeIds: z.array(uuid).optional(),
      locales: z.array(locale).optional(),
      statuses: z.array(z.enum(['draft', 'published', 'archived'])).optional(),
    })
    .optional(),
});

/** A core kind, or a data provider's kind (`<plugin id>.<name>`). */
const configKind = z.union([z.enum(CONFIG_KINDS), z.string().regex(/^[a-z][a-z0-9-]*\.[\w-]+$/)]);

/** What to write as config source: whole kinds, or entries by id. */
const configSelection = z.object({
  kinds: z.array(configKind).min(1).optional(),
  ids: z.record(configKind, z.array(uuid)).optional(),
});

const spaceFields = z.object({
  name: z.string().min(1).max(200),
  machineName,
  description: z.string().nullable().optional(),
  url: z.string().url(),
  defaultLocale: locale,
  locales: localeList,
  settings: z.record(z.string(), z.unknown()).optional(),
});
// Defaults only on create: zod 4 applies them inside `.partial()` too.
const spaceSchema = spaceFields.extend({
  defaultLocale: locale.default('en'),
  locales: localeList.default(['en']),
});

/** A space without its group, invisible outside the control API. */
function visible<T extends { groupId: string | null }>(space: T): Omit<T, 'groupId'> {
  const { groupId: _groupId, ...rest } = space;
  return rest;
}

/** Spaces and membership. The rules are in `SpaceService`. */
export const spaceRouter = {
  /** The caller's spaces, bounded by membership; a superadmin sees all. */
  list: authed.handler(async ({ context }) => {
    const { principal } = context;
    const all = await context.spaces.list(
      principal.role === 'superadmin' ? null : Object.keys(principal.spaces),
    );
    const allowed = principal.allowedSpaceIds;
    return (allowed ? all.filter((space) => allowed.includes(space.id)) : all).map((space) =>
      visible(space),
    );
  }),

  get: scoped('space:read')
    .input(spaceScoped)
    .handler(async ({ input, context }) => {
      const space = await context.spaces.get(input.spaceId);
      return space && visible(space);
    }),

  /**
   * `starter` seeds a website type's content model, pages and a menu; `true` is the basic
   * one. `blocks` are the catalog blocks of the `custom` type. `plan` adds types the way
   * `contentTypes.applyPlan` does, after the starter. `plugins` are the plugins'
   * create step drafts by plugin id; `warnings` in the result are what their after-commit
   * steps could not finish.
   */
  create: superadminWrite
    .input(
      spaceSchema.extend({
        starter: z.union([z.boolean(), z.enum(SPACE_TEMPLATE_IDS)]).default(false),
        blocks: z.array(z.enum(SPACE_BLOCK_IDS)).max(SPACE_BLOCK_IDS.length).optional(),
        plugins: z.record(z.string().min(1).max(100), z.unknown()).optional(),
        plan: contentTypePlan.optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await context.manablox.controls.assertFeature(null, 'spaceCreate');
      const { starter, blocks, plan, ...data } = input;
      const template = starter === true ? 'basic' : starter || null;
      const { principal } = context;
      // The starter and plugin steps share the space's transaction; a failure leaves no space.
      const { warnings, ...space } = await context.spaces.create(
        data,
        principal.userId,
        template || plan
          ? async (created, repos) => {
              if (template) {
                await applySpaceStarter(
                  { ...context, repos },
                  created,
                  { userId: principal.userId, roles: actorRoles(principal, created.id) },
                  template,
                  blocks,
                );
              }
              if (plan) {
                await context.contentTypes
                  .using(repos)
                  .applyPlan(created.id, plan, principal.userId);
              }
            }
          : undefined,
        // All-space declarations apply to new spaces, after the starter so they can name its types.
        (created) =>
          context.codeResources.sync({ spaceIds: [created.id], actorId: principal.userId }),
      );
      // What plugins could not finish once the space existed.
      return { ...visible(space), warnings };
    }),

  update: scoped('space:write')
    .input(spaceFields.partial().extend(spaceScoped.shape))
    .handler(async ({ input, context }) => {
      const { spaceId, environment: _environment, ...data } = input;
      return visible(await context.spaces.update(spaceId, data));
    }),

  delete: scoped('space:delete')
    .input(spaceScoped)
    .handler(async ({ input, context }) => {
      await context.spaces.delete(input.spaceId);
      // Own assets are deleted; shared ones only lose this space.
      await context.media.purgeOrphaned();
      return { ok: true };
    }),

  /** Nominates one document as the space's root; `null` clears it. */
  setHome: scoped('space:write')
    .input(spaceScoped.extend({ contentId: uuid.nullable() }))
    .handler(async ({ input, context }) =>
      visible(await context.spaces.setHome(context.env, input.contentId)),
    ),

  /** Upload limits narrowing the instance's. Absent or empty `allowedMimeTypes` means the instance list. */
  setAssetSettings: scoped('space:write')
    .input(
      spaceScoped.extend({
        allowedMimeTypes: z.array(mimeTypePattern).max(50).optional(),
        maxFileSize: z.number().int().positive().nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) =>
      visible(
        await context.spaces.setAssetSettings(input.spaceId, {
          ...(input.allowedMimeTypes?.length ? { allowedMimeTypes: input.allowedMimeTypes } : {}),
          ...(input.maxFileSize ? { maxFileSize: input.maxFileSize } : {}),
        }),
      ),
    ),

  /** The space's contents per section, for the transfer dialog. */
  inventory: scoped('space:export')
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.spaces.inventory(input.spaceId)),

  /** What can be written as config source. */
  configInventory: scoped('space:export')
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.spaces.configInventory(input.spaceId)),

  /** The admin-built model as `manablox.config.ts` `define*` calls. Code-declared rows are skipped. */
  configSource: scoped('space:export')
    .input(spaceScoped.extend({ selection: configSelection.optional() }))
    .handler(async ({ input, context }) =>
      context.spaces.configSource(input.spaceId, input.selection),
    ),

  /** The whole space as JSON. Own permission, since it ignores per-field read rules. */
  export: scoped('space:export')
    .input(spaceScoped.extend({ selection: transferSelection.optional() }))
    .handler(async ({ input, context }) =>
      context.spaces.export(context.env ?? input.spaceId, input.selection),
    ),

  /** Restores an export as a new space. Superadmin. */
  import: superadminWrite
    .input(z.object({ payload: z.unknown(), selection: transferSelection.optional() }))
    .handler(async ({ input, context }) =>
      context.spaces.import(input.payload, context.principal.userId, input.selection),
    ),

  /** Continues an interrupted import from its staged file. Superadmin. */
  resumeImport: superadminWrite
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.spaces.resumeImport(input.spaceId)),

  members: scoped('user:read')
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.spaces.members(input.spaceId)),

  grant: scoped('user:write')
    .input(spaceScoped.extend({ userId: uuid, role: machineName }))
    .handler(async ({ input, context }) => {
      await context.spaces.grant(input.spaceId, input.userId, input.role);
      return { ok: true };
    }),

  /** Users who are not yet members, for the add-member picker. */
  candidates: scoped('user:write')
    .input(spaceScoped.extend({ search: searchTerm.optional() }))
    .handler(async ({ input, context }) => context.spaces.candidates(input.spaceId, input.search)),

  /** Grants one role to several users. */
  addMembers: scoped('user:write')
    .input(
      spaceScoped.extend({
        userIds: z.array(uuid).min(1).max(100),
        role: machineName.default('editor'),
      }),
    )
    .handler(async ({ input, context }) => ({
      ok: true,
      added: await context.spaces.addMembers(input.spaceId, input.userIds, input.role),
    })),

  revoke: scoped('user:write')
    .input(spaceScoped.extend({ userId: uuid }))
    .handler(async ({ input, context }) => {
      await context.spaces.revoke(input.spaceId, input.userId);
      return { ok: true };
    }),

  /** A space's locales. */
  locales: base
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.spaces.locales(input.spaceId)),
};
