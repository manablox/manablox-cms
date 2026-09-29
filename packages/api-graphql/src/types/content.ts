import { type ContentTypeDefinition, graphqlTypeName, type LinkValue } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow } from '@manablox/db';
import type { Builder, InterfaceRefOf, ObjectRefOf } from '../builder.js';
import type { FieldMapper } from '../fields.js';
import { loadLinkTarget } from '../relations.js';

/** `ContentNode`, which every document type implements, and `Link`, which points at one. */
export function defineContentInterface(
  builder: Builder,
  manablox: Manablox,
  tagRef: ObjectRefOf<{ name: string; slug: string }>,
) {
  /** One interface so a query can ask for any content without knowing its type. */
  const contentInterface = builder.interfaceRef<ContentRow>('ContentNode').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      slug: t.exposeString('slug'),
      permalink: t.exposeString('permalink', { nullable: true }),
      locale: t.exposeString('locale'),
      status: t.exposeString('status'),
      typeName: t.string({
        resolve: (row, _a, ctx) => ctx.manablox.contentTypes.get(row.typeId).name,
      }),
      publishedAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.publishedAt }),
      updatedAt: t.field({ type: 'DateTime', resolve: (row) => row.updatedAt }),
      /** Shared by every translation of the document. */
      tags: t.field({
        type: [tagRef],
        resolve: (row, _a, ctx) => ctx.loaders.contentTags.load(row.localizationId),
      }),
    }),
    resolveType: (row) => graphqlTypeName(manablox.contentTypes.get(row.typeId).name),
  });

  /** A `link` field; `href` is `null` when an internal target is gone or unpublished. */
  const linkRef = builder.objectRef<LinkValue>('Link').implement({
    fields: (t) => ({
      mode: t.exposeString('mode'),
      target: t.exposeString('target'),
      label: t.exposeString('label', { nullable: true }),
      /** Set for an external link, `null` for an internal one. */
      url: t.exposeString('url', { nullable: true }),
      href: t.string({
        nullable: true,
        resolve: async (link, _a, ctx) => {
          if (link.mode === 'external') return link.url;
          const row = await loadLinkTarget(ctx, link);
          return row?.permalink ?? null;
        },
      }),
      content: t.field({
        type: contentInterface,
        nullable: true,
        resolve: (link, _a, ctx) => loadLinkTarget(ctx, link),
      }),
    }),
  });

  return { contentInterface, linkRef };
}

/** One object type per document type, with its fields plus `parent` and `children`. */
export function defineContentTypes(
  builder: Builder,
  contentTypes: ContentTypeDefinition[],
  contentRefs: Map<string, ObjectRefOf<ContentRow>>,
  contentInterface: InterfaceRefOf<ContentRow>,
  buildFieldMap: FieldMapper,
): void {
  for (const type of contentTypes) {
    const ref = contentRefs.get(type.id);
    if (!ref) continue;
    builder.objectType(ref, {
      interfaces: [contentInterface],
      isTypeOf: (value) => (value as ContentRow).typeId === type.id,
      fields: (t) => ({
        ...buildFieldMap(t, type, (row: ContentRow) => row.fields),
        parent: t.field({
          type: contentInterface,
          nullable: true,
          resolve: (row, _args, ctx) => (row.parentId ? ctx.reader.byId(row.parentId) : null),
        }),
        children: t.field({
          type: [contentInterface],
          resolve: (row, _args, ctx) => ctx.reader.children(row.id),
        }),
      }),
    });
  }
}
