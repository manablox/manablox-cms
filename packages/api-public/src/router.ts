import {
  CONTENT_TYPE_KINDS,
  type FieldDefinition,
  fieldSubFields,
  isExpectedError,
  ManabloxError,
  MENU_ITEM_TARGETS,
  type MenuItemTarget,
  resolveGraphQL,
  TRANSPORT_CODE,
  toTransportError,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import {
  PUBLIC_LIST_DEFAULT_LIMIT,
  PUBLIC_LIST_MAX_LIMIT,
  type PublicMenuItem,
} from '@manablox/services';
import { isProcedure, ORPCError, os, Procedure } from '@orpc/server';
import { z } from 'zod';
import type { PublicContext } from './context.js';
import {
  type PublicAsset,
  type PublicContent,
  parseExpand,
  serializeAsset,
  serializeContent,
  serializeContents,
  toPublicTags,
} from './serialize.js';

/** One field of `/v1/types`; `fields` describes each item of an `items` field. */
interface ModelField {
  name: string;
  type: string;
  required: boolean;
  list: boolean;
  kind: 'scalar' | 'ref' | 'block' | 'blockRef' | 'link' | 'items';
  scalar?: string | undefined;
  target?: 'content' | 'asset' | 'user' | undefined;
  blockTypes?: string[] | undefined;
  fields?: ModelField[] | undefined;
}

const modelField: z.ZodType<ModelField> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    list: z.boolean(),
    /** `blockRef` reads as a block list. */
    kind: z.enum(['scalar', 'ref', 'block', 'blockRef', 'link', 'items']),
    scalar: z.string().optional(),
    target: z.enum(['content', 'asset', 'user']).optional(),
    blockTypes: z.array(z.string()).optional(),
    fields: z.array(modelField).optional(),
  }),
);

/** Unauthenticated base procedure; only maps errors. */
const base = os.$context<PublicContext>().use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (!isExpectedError(error)) throw error;
    // Anonymous, so internal details are masked.
    const transport = toTransportError(error, { mask: true });
    throw new ORPCError(TRANSPORT_CODE[transport.kind], {
      status: transport.status,
      message: transport.message,
      data: transport,
      cause: error,
    });
  }
});

const uuid = z.string().uuid();
const expandArg = z
  .string()
  .max(200)
  .optional()
  .describe('Comma-separated relation fields to inline, e.g. `hero,author`.');

const tagSchema = z.object({ name: z.string(), slug: z.string() });

const contentSchema: z.ZodType<PublicContent> = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  slug: z.string(),
  permalink: z.string().nullable(),
  locale: z.string(),
  parentId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  fields: z.record(z.string(), z.unknown()),
  tags: z.array(tagSchema),
});

const assetSchema: z.ZodType<PublicAsset> = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  alt: z.string().nullable(),
  title: z.string().nullable(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullable(),
  crop: z
    .object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  variants: z.record(z.string(), z.string()),
  tags: z.array(tagSchema),
});

/** A menu entry for REST: the document inlined, sub-entries nested. */
interface PublicMenuEntry {
  id: string;
  label: string;
  url: string | null;
  /** `_self` or `_blank`. */
  target: string;
  content: PublicContent | null;
  children: PublicMenuEntry[];
}

const menuItemSchema: z.ZodType<PublicMenuEntry> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    url: z.string().nullable(),
    target: z.enum(MENU_ITEM_TARGETS as [MenuItemTarget, ...MenuItemTarget[]]),
    content: contentSchema.nullable(),
    children: z.array(menuItemSchema),
  }),
);

const menuSchema = z.object({
  id: z.string(),
  name: z.string(),
  machineName: z.string(),
  items: z.array(menuItemSchema),
});

const redirectSchema = z.object({
  locale: z.string().nullable(),
  fromPath: z.string(),
  toPath: z.string(),
  status: z.number(),
  contentId: z.string().nullable(),
});

const listSchema = z.object({
  items: z.array(contentSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/** Public delivery API (REST, OpenAPI, SDK types). The space is pinned in the context. */
export const publicRouter = {
  list: base
    .route({
      method: 'GET',
      path: '/content',
      summary: 'List published documents',
      tags: ['content'],
    })
    .input(
      z.object({
        type: z.string().max(100).optional(),
        parentId: uuid.optional(),
        under: uuid.optional(),
        search: z.string().max(200).optional(),
        tags: z
          .string()
          .max(400)
          .optional()
          .describe('Comma-separated tag slugs; a document carrying any of them matches.'),
        locale: z.string().max(10).optional(),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(PUBLIC_LIST_MAX_LIMIT)
          .default(PUBLIC_LIST_DEFAULT_LIMIT),
        offset: z.coerce.number().int().min(0).default(0),
        expand: expandArg,
      }),
    )
    .output(listSchema)
    .handler(async ({ input, context }) => {
      const page = await context.reader.list(context.spaceId, input);

      return {
        items: await serializeContents(page.items, context, parseExpand(input.expand)),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      };
    }),

  get: base
    .route({
      method: 'GET',
      path: '/content/{id}',
      summary: 'Fetch one published document by id',
      tags: ['content'],
    })
    .input(z.object({ id: uuid, expand: expandArg }))
    .output(contentSchema)
    .handler(async ({ input, context }) => {
      // Space-scoped loader: other tenants' ids do not resolve.
      const row = await context.reader.get(input.id);
      if (!row) throw ManabloxError.notFound('content.notFound', { id: input.id });
      return serializeContent(row, context, parseExpand(input.expand));
    }),

  byPermalink: base
    .route({
      method: 'GET',
      path: '/permalink/{+path}',
      summary: 'Resolve a URL path to a document',
      tags: ['content'],
    })
    .input(
      z.object({
        path: z.string().max(2000),
        locale: z.string().max(10).optional(),
        expand: expandArg,
      }),
    )
    .output(contentSchema)
    .handler(({ input, context }) => resolvePermalink(input.path, input, context)),

  // `{+path}` cannot be empty, so the home page gets its own route.
  home: base
    .route({
      method: 'GET',
      path: '/permalink',
      summary: "Resolve the space's home page",
      tags: ['content'],
    })
    .input(z.object({ locale: z.string().max(10).optional(), expand: expandArg }))
    .output(contentSchema)
    .handler(({ input, context }) => resolvePermalink('', input, context)),

  menu: base
    .route({
      method: 'GET',
      path: '/menus/{name}',
      summary: 'A navigation menu by name',
      tags: ['content'],
    })
    .input(
      z.object({
        name: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*$/)
          .max(64),
        locale: z.string().max(10).optional(),
        expand: expandArg,
      }),
    )
    .output(menuSchema)
    .handler(async ({ input, context }) => {
      const menu = await context.reader.menu(context.spaceId, input.name, input.locale);
      if (!menu) throw ManabloxError.notFound('menu.notFound', { id: input.name });

      // Serialise all documents in one batch, then rebuild the tree.
      const rows = collectMenuRows(menu.items);
      const serialised = await serializeContents(rows, context, parseExpand(input.expand));
      const byId = new Map(rows.map((row, index) => [row.id, serialised[index] as PublicContent]));
      const toEntry = (item: PublicMenuItem): PublicMenuEntry => ({
        id: item.id,
        label: item.label,
        url: item.url,
        target: item.target,
        content: item.content ? (byId.get(item.content.id) ?? null) : null,
        children: item.children.map(toEntry),
      });
      return {
        id: menu.id,
        name: menu.name,
        machineName: menu.machineName,
        items: menu.items.map(toEntry),
      };
    }),

  redirects: base
    .route({
      method: 'GET',
      path: '/redirects',
      summary: "Every redirect of a locale, the locale's own before shared ones",
      tags: ['content'],
    })
    .input(z.object({ locale: z.string().max(10).optional() }))
    .output(z.object({ items: z.array(redirectSchema) }))
    .handler(async ({ input, context }) => ({
      items: await context.reader.redirects(context.spaceId, input.locale),
    })),

  asset: base
    .route({
      method: 'GET',
      path: '/assets/{id}',
      summary: 'Fetch asset metadata',
      tags: ['media'],
    })
    .input(z.object({ id: uuid }))
    .output(assetSchema)
    .handler(async ({ input, context }) => {
      // The loader is space-scoped and publication-gated.
      const asset = await context.reader.asset(input.id);
      if (!asset) throw ManabloxError.notFound('asset.notFound', { id: input.id });
      const tags = await context.repos.tags.listByAssets([asset.id], context.spaceId);
      return serializeAsset(asset, context, undefined, toPublicTags(tags.get(asset.id) ?? []));
    }),

  types: base
    .route({
      method: 'GET',
      path: '/types',
      summary: 'The space content model, for SDK type generation',
      tags: ['schema'],
    })
    .input(z.object({}).optional())
    .output(
      z.object({
        types: z.array(
          z.object({
            name: z.string(),
            label: z.string(),
            kind: z.enum(CONTENT_TYPE_KINDS),
            fields: z.array(modelField),
          }),
        ),
      }),
    )
    .handler(({ context }) => {
      const registry = context.manablox.contentTypes;
      if (context.touched) context.touched.spaceWide = true;

      return {
        types: registry.forSpace(context.scope ?? context.spaceId).map((type) => ({
          name: type.name,
          label: type.label,
          kind: type.kind,
          fields: describeFields(context, type.fields),
        })),
      };
    }),
};

export type PublicRouter = typeof publicRouter;

function describeFields(context: PublicContext, fields: FieldDefinition[]): ModelField[] {
  const registry = context.manablox.contentTypes;
  return (
    fields
      // Role-gated fields are never delivered, so omit them from the types.
      .filter((field) => !field.readRoles?.length)
      .flatMap((field) => {
        const fieldType = registry.fieldTypes.tryGet(field.type);
        if (!fieldType) return [];
        const spec = resolveGraphQL(fieldType, field.settings);
        const blockTypes = blockTypeNames(context, field.settings);
        const subFields = fieldSubFields(fieldType, field.settings);

        return [
          {
            name: field.name,
            type: field.type,
            required: field.required ?? false,
            list: spec.list ?? false,
            kind: spec.type.kind,
            ...(spec.type.kind === 'scalar' ? { scalar: spec.type.name } : {}),
            ...(spec.type.kind === 'ref' ? { target: spec.type.target } : {}),
            ...(spec.type.kind === 'block' && blockTypes ? { blockTypes } : {}),
            ...(subFields ? { fields: describeFields(context, subFields) } : {}),
          },
        ];
      })
  );
}

/** Maps a `blocks` field's allowed type ids to names. */
function blockTypeNames(context: PublicContext, settings: unknown): string[] | undefined {
  const types = (settings as { types?: unknown } | undefined)?.types;
  if (!Array.isArray(types)) return undefined;
  return types
    .filter((id): id is string => typeof id === 'string')
    .map((id) => context.manablox.contentTypes.tryGet(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function collectMenuRows(items: PublicMenuItem[]): ContentRow[] {
  const out: ContentRow[] = [];
  for (const item of items) {
    if (item.content) out.push(item.content);
    out.push(...collectMenuRows(item.children));
  }
  return out;
}

async function resolvePermalink(
  path: string,
  input: { locale?: string | undefined; expand?: string | undefined },
  context: PublicContext,
): Promise<PublicContent> {
  const row = await context.reader.byPermalink(context.spaceId, path, input.locale);
  if (!row) {
    throw ManabloxError.notFound('content.notFound', {
      permalink: path.replace(/^\/+|\/+$/g, ''),
    });
  }
  return serializeContent(row, context, parseExpand(input.expand));
}

/**
 * `router` without runtime output validation: the output schemas still describe every answer
 * in the OpenAPI document, but the answers are not parsed against them. For production, where
 * the tests and development runs (which keep validation) vouch for the shapes.
 */
export function withoutOutputValidation<T extends object>(router: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(router)) {
    if (isProcedure(entry)) {
      const { outputSchema: _unchecked, ...def } = entry['~orpc'];
      out[name] = new Procedure(def);
    } else if (entry && typeof entry === 'object') {
      out[name] = withoutOutputValidation(entry);
    } else {
      out[name] = entry;
    }
  }
  return out as T;
}
