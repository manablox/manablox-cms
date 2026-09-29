import { can } from '@manablox/auth';
import { FOLDER_TYPE_NAME, ManabloxError } from '@manablox/core';
import { z } from 'zod';
import { scoped } from '../base.js';
import {
  allowedTypeIdsIn,
  assertOnDocument,
  assertOnType,
  grantTypeId,
  narrowToAllowed,
  toActor,
} from '../guards.js';
import {
  locale,
  pagination,
  scheduleAt,
  searchTerm,
  spaceItem,
  spaceScoped,
  uuid,
} from '../schemas.js';
import { contentApprovalRouter } from './content-approval.js';

const filterSchema = spaceScoped.extend({
  /** Specific documents by id, in one request. */
  ids: z.array(uuid).max(200).optional(),
  typeIds: z.array(uuid).optional(),
  locale: locale.optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  parentId: uuid.nullable().optional(),
  under: uuid.optional(),
  search: searchTerm.optional(),
  /** Tag ids; a document carrying any of them is kept. */
  tagIds: z.array(uuid).max(20).optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        op: z.enum([
          'eq',
          'neq',
          'lt',
          'lte',
          'gt',
          'gte',
          'in',
          'notIn',
          'contains',
          'startsWith',
          'endsWith',
          'isNull',
          'isNotNull',
        ]),
        value: z.unknown().optional(),
      }),
    )
    .max(10)
    .optional(),
});

const paginationSchema = pagination({ limit: 25, max: 200 });

/** Tree levels load in pages of 50; the ceiling is higher for long levels. */
const treePagination = pagination({ limit: 50, max: 200 });
const historyPagination = pagination({ limit: 50, max: 200 });

const sortSchema = z
  .array(
    z.object({
      by: z.enum(['position', 'title', 'createdAt', 'updatedAt', 'publishedAt', 'slug']),
      direction: z.enum(['asc', 'desc']).default('asc'),
    }),
  )
  .max(3);

const saveSchema = spaceScoped.extend({
  typeId: uuid,
  locale: locale.default('en'),
  localizationId: uuid.optional(),
  parentId: uuid.nullable().optional(),
  title: z.string().min(1).max(500),
  slug: z.string().max(200).optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  position: z.number().int().optional(),
  expectedVersion: z.number().int().positive().optional(),
  /** Replaces the document's tags; absent leaves them alone. */
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export const contentRouter = {
  list: scoped('content:read')
    .input(
      z
        .object({
          filter: filterSchema,
          pagination: paginationSchema,
          sort: sortSchema.optional(),
        })
        .transform((v) => ({ ...v, spaceId: v.filter.spaceId })),
    )
    .handler(async ({ input, context }) => {
      // A type the role cannot read yields an empty page, not a refusal.
      const allowed = narrowToAllowed(context, input.filter);
      if (!allowed) return { items: [], total: 0, ...input.pagination };
      const { environment: _environment, ...filter } = allowed;
      const scoped = { ...filter, environmentId: context.env.environmentId };
      return context.content.list(scoped, input.pagination, input.sort ?? [], {
        actor: toActor(context, input.filter.spaceId),
      });
    }),

  tree: scoped('content:read')
    .input(
      spaceScoped.extend({
        locale: locale.default('en'),
        rootId: uuid.nullable().default(null),
      }),
    )
    .handler(async ({ input, context }) =>
      context.content.tree(context.env, input.locale, input.rootId, {
        actor: toActor(context, input.spaceId),
        typeIds: allowedTypeIdsIn(context, input.spaceId, 'content:read'),
      }),
    ),

  /** One page of a tree level. `parentId` null is the root. */
  treeChildren: scoped('content:read')
    .input(
      spaceScoped.extend({
        locale: locale.default('en'),
        parentId: uuid.nullable().default(null),
        pagination: treePagination,
      }),
    )
    .handler(async ({ input, context }) => {
      return context.content.treeChildren(context.env, input.locale, input.parentId, {
        ...input.pagination,
        actor: toActor(context, input.spaceId),
        typeIds: allowedTypeIdsIn(context, input.spaceId, 'content:read'),
      });
    }),

  /** Tree documents matching a term, with their ancestors to draw them in place. */
  treeSearch: scoped('content:read')
    .input(
      spaceScoped.extend({
        locale: locale.default('en'),
        search: searchTerm.min(1),
        /** Only these types count as matches. */
        typeIds: z.array(uuid).max(100).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .handler(async ({ input, context }) =>
      context.content.treeSearch(context.env, input.locale, input.search, {
        limit: input.limit,
        actor: toActor(context, input.spaceId),
        typeIds: allowedTypeIdsIn(context, input.spaceId, 'content:read'),
        matchTypeIds: input.typeIds?.length ? input.typeIds : null,
      }),
    ),

  /** A document's ancestors, root first. */
  ancestors: scoped('content:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      return context.content.ancestorIds(context.env, input.id);
    }),

  get: scoped('content:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      const row = await context.content.get(context.env, input.id, {
        actor: toActor(context, input.spaceId),
      });
      if (!row) return null;
      // Tags belong to the localization group, so every translation reads the same ones.
      const byGroup = await context.tags.ofContent([row.localizationId]);
      return { ...row, tags: byGroup.get(row.localizationId) ?? [] };
    }),

  /** Field values with defaults filled in, for a new document. */
  blank: scoped('content:read')
    .input(spaceScoped.extend({ typeId: uuid }))
    .handler(async ({ input, context }) => {
      assertOnType(context, input.spaceId, 'content:read', input.typeId);
      return {
        fields: await context.content.initFields(
          context.contentTypes.get(context.env, input.typeId),
        ),
      };
    }),

  create: scoped('content:write')
    .input(saveSchema)
    .handler(async ({ input, context }) => {
      assertOnType(context, input.spaceId, 'content:write', input.typeId);
      const actor = toActor(context, input.spaceId);
      const row = await context.content.create(
        { ...input, environmentId: context.env.environmentId },
        actor,
      );
      if (input.tags) {
        await context.tags.setForContent(
          context.env,
          row.localizationId,
          input.tags,
          actor?.userId ?? null,
        );
      }
      // Under review and the creator cannot publish: open a request right away.
      const type = context.manablox.contentTypes.get(row.typeId);
      if (
        type.requiresApproval &&
        !input.localizationId &&
        !can(
          context.principal,
          input.spaceId,
          'content:publish',
          grantTypeId(context, row.typeId),
        ) &&
        (await context.manablox.controls.feature(input.spaceId, 'approvals')).enabled
      ) {
        await context.approvals.request(context.env, row.id, actor);
      }
      return row;
    }),

  update: scoped('content:write')
    .input(saveSchema.extend({ id: uuid }))
    .handler(async ({ input, context }) => {
      assertOnType(context, input.spaceId, 'content:write', input.typeId);
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      const actor = toActor(context, input.spaceId);
      const row = await context.content.update(context.env, input.id, input, actor);
      if (input.tags) {
        await context.tags.setForContent(
          context.env,
          row.localizationId,
          input.tags,
          actor?.userId ?? null,
        );
      }
      return row;
    }),

  delete: scoped('content:delete')
    .input(
      spaceItem.extend({
        /** Delete the children too, or lift them into this node's place. */
        children: z.enum(['cascade', 'reparent']).default('cascade'),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:delete', input.id);
      await context.content.delete(
        context.env,
        input.id,
        toActor(context, input.spaceId),
        input.children,
      );
      return { ok: true };
    }),

  publish: scoped('content:publish')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:publish', input.id);
      return context.content.publish(context.env, input.id, toActor(context, input.spaceId));
    }),

  unpublish: scoped('content:publish')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:publish', input.id);
      await context.content.unpublish(context.env, input.id, toActor(context, input.spaceId));
      return { ok: true };
    }),

  /** Schedules publish and unpublish. Needs the publish permission. */
  schedule: scoped('content:publish')
    .input(
      spaceItem.extend({
        publishAt: scheduleAt,
        unpublishAt: scheduleAt,
      }),
    )
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:publish', input.id);
      return context.content.schedule(context.env, input.id, {
        ...(input.publishAt !== undefined ? { publishAt: input.publishAt } : {}),
        ...(input.unpublishAt !== undefined ? { unpublishAt: input.unpublishAt } : {}),
      });
    }),

  /** Reparents or reorders a document in the tree. */
  move: scoped('content:write')
    .input(
      spaceItem.extend({
        parentId: uuid.nullable(),
        position: z.number().int().min(0),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.content.move(context.env, input.id, input.parentId, input.position);
    }),

  /** Creates an addressless folder node in every locale, so the tree matches across languages. */
  createFolder: scoped('content:write')
    .input(
      spaceScoped.extend({
        locale: locale.default('en'),
        parentId: uuid.nullable().optional(),
        title: z.string().min(1).max(500),
        position: z.number().int().min(0).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const folderType = context.manablox.contentTypes.tryGetByName(FOLDER_TYPE_NAME, context.env);
      if (!folderType) {
        throw ManabloxError.badRequest('content.folder.typeMissing', { name: FOLDER_TYPE_NAME });
      }
      assertOnType(context, input.spaceId, 'content:write', folderType.id);
      const { primary } = await context.content.createFolder(
        context.env,
        {
          title: input.title,
          locale: input.locale,
          parentId: input.parentId ?? null,
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
        toActor(context, input.spaceId),
      );
      return primary;
    }),

  /** Every locale a document exists in. */
  translations: scoped('content:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      return context.content.translations(context.env, input.id);
    }),

  /** Starts a translation in the document's localization group. */
  createTranslation: scoped('content:write')
    .input(spaceItem.extend({ locale }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.content.createTranslation(
        context.env,
        input.id,
        input.locale,
        toActor(context, input.spaceId),
      );
    }),

  /**
   * Copies a document beside the original, as a draft. Also used for templates.
   * With `children`, the subtree below it is copied as well.
   */
  duplicate: scoped('content:write')
    .input(spaceItem.extend({ children: z.boolean().optional() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.content.duplicate(context.env, input.id, toActor(context, input.spaceId), {
        children: input.children ?? false,
      });
    }),

  ...contentApprovalRouter,

  /** A page of stored versions, newest first. */
  versions: scoped('content:read')
    .input(spaceItem.extend({ pagination: historyPagination }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      return context.content.versions(context.env, input.id, input.pagination);
    }),

  versionSnapshot: scoped('content:read')
    .input(spaceItem.extend({ version: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      return context.content.versionSnapshot(
        context.env,
        input.id,
        input.version,
        toActor(context, input.spaceId),
      );
    }),

  restore: scoped('content:write')
    .input(spaceItem.extend({ version: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.content.restore(
        context.env,
        input.id,
        input.version,
        toActor(context, input.spaceId),
      );
    }),
};
