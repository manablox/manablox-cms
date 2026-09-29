import type { AssetRow, ContentRow } from '@manablox/db';
import {
  PUBLIC_LIST_DEFAULT_LIMIT,
  type PublicListArgs,
  type PublicMenu,
  type PublicRedirect,
} from '@manablox/services';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import type { Builder, ContentPageShape, InterfaceRefOf, ObjectRefOf } from './builder.js';
import type { GraphQLContext } from './context.js';

/** The query root: routing, lists, menus, redirects and assets. */
export function defineRoot(
  builder: Builder,
  refs: {
    contentInterface: InterfaceRefOf<ContentRow>;
    menuRef: ObjectRefOf<PublicMenu>;
    assetRef: ObjectRefOf<AssetRow>;
  },
  pinnedSpace: boolean,
): void {
  const { contentInterface, menuRef, assetRef } = refs;

  /** A page of documents with its total, for pagers. */
  const contentPageRef = builder.objectRef<ContentPageShape>('ContentPage').implement({
    fields: (t) => ({
      items: t.field({ type: [contentInterface], resolve: (page) => page.items }),
      total: t.exposeInt('total'),
      limit: t.exposeInt('limit'),
      offset: t.exposeInt('offset'),
    }),
  });

  const listArgs = builder.args((t) => ({
    type: t.string(),
    spaceId: t.string(),
    locale: t.string(),
    parentId: t.string(),
    under: t.string(),
    search: t.string(),
    tags: t.string({ description: 'Comma-separated tag slugs; any of them matches.' }),
    limit: t.int({ defaultValue: PUBLIC_LIST_DEFAULT_LIMIT }),
    offset: t.int({ defaultValue: 0 }),
  }));

  const listPage = (
    ctx: GraphQLContext,
    args: PublicListArgs & { spaceId?: string | null | undefined },
  ) => {
    const spaceId = pinnedSpace ? ctx.spaceId : (args.spaceId ?? ctx.spaceId);
    return spaceId ? ctx.reader.list(spaceId, args) : null;
  };

  /** A redirect of the requested locale; see `redirects`. */
  const redirectRef = builder.objectRef<PublicRedirect>('Redirect').implement({
    fields: (t) => ({
      /** `null`: it applies to every locale. */
      locale: t.exposeString('locale', { nullable: true }),
      /** Leading slash, no locale prefix. */
      fromPath: t.exposeString('fromPath'),
      /** A path like `fromPath`, or an absolute `http(s)` URL. */
      toPath: t.exposeString('toPath'),
      status: t.exposeInt('status'),
      /** The target document's id; `null` for a path target. */
      contentId: t.exposeString('contentId', { nullable: true }),
    }),
  });

  builder.queryType({
    fields: (t) => ({
      /** Routing entry point: resolve a URL path to a document. */
      contentByPermalink: t.field({
        type: contentInterface,
        nullable: true,
        args: {
          permalink: t.arg.string({ required: true }),
          locale: t.arg.string(),
          spaceId: t.arg.string(),
        },
        resolve: (_root, args, ctx) => {
          const spaceId = pinnedSpace ? ctx.spaceId : (args.spaceId ?? ctx.spaceId);
          return spaceId ? ctx.reader.byPermalink(spaceId, args.permalink, args.locale) : null;
        },
      }),

      content: t.field({
        type: contentInterface,
        nullable: true,
        args: { id: t.arg.string({ required: true }) },
        resolve: (_root, args, ctx) => ctx.reader.get(args.id),
      }),

      /** Filtered lists with the total count, for pagers. */
      contentsPage: t.field({
        type: contentPageRef,
        args: listArgs,
        resolve: async (_root, args, ctx) =>
          (await listPage(ctx, args)) ?? {
            items: [],
            total: 0,
            limit: args.limit ?? PUBLIC_LIST_DEFAULT_LIMIT,
            offset: args.offset ?? 0,
          },
      }),

      /** Navigation: one named menu, its entries nested, in one query. */
      menu: t.field({
        type: menuRef,
        nullable: true,
        args: {
          name: t.arg.string({ required: true }),
          spaceId: t.arg.string(),
          locale: t.arg.string(),
        },
        resolve: (_root, args, ctx) => {
          const spaceId = pinnedSpace ? ctx.spaceId : (args.spaceId ?? ctx.spaceId);
          return spaceId ? ctx.reader.menu(spaceId, args.name, args.locale) : null;
        },
      }),

      /** Every redirect of a locale, its own before shared ones. */
      redirects: t.field({
        type: [redirectRef],
        args: { spaceId: t.arg.string(), locale: t.arg.string() },
        resolve: (_root, args, ctx) => {
          const spaceId = pinnedSpace ? ctx.spaceId : (args.spaceId ?? ctx.spaceId);
          return spaceId ? ctx.reader.redirects(spaceId, args.locale) : [];
        },
      }),

      asset: t.field({
        type: assetRef,
        nullable: true,
        args: { id: t.arg.string({ required: true }) },
        resolve: (_root, args, ctx) => ctx.reader.asset(args.id),
      }),
    }),
  });
}

/** The schema without `spaceId` on any root field, so a pinned instance rejects it. */
export function withoutSpaceArgument(schema: GraphQLSchema): GraphQLSchema {
  const query = schema.getQueryType();
  if (!query) return schema;

  const config = query.toConfig();
  const rebuilt = new GraphQLObjectType({
    ...config,
    fields: Object.fromEntries(
      Object.entries(config.fields).map(([name, field]) => [
        name,
        {
          ...field,
          args: Object.fromEntries(
            Object.entries(field.args ?? {}).filter(([argName]) => argName !== 'spaceId'),
          ),
        },
      ]),
    ),
  });

  const schemaConfig = schema.toConfig();
  return new GraphQLSchema({
    ...schemaConfig,
    query: rebuilt,
    types: schemaConfig.types.filter((type) => type !== query),
  });
}
