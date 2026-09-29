import type { LinkValue } from '@manablox/core';
import type { GraphQLContext } from './context.js';

/** A `filter` relation's rows, once per field per request. */
export async function resolveRelationQuery(
  ctx: GraphQLContext,
  target: 'content' | 'asset' | 'user',
  fieldId: string,
  settings: Record<string, unknown>,
) {
  return (await ctx.reader.relation(fieldId, target, settings)).items;
}

/** The document an internal link points at. */
export function loadLinkTarget(ctx: GraphQLContext, link: LinkValue) {
  if (link.mode !== 'internal' || !link.contentId) return null;
  return ctx.reader.byId(link.contentId);
}

export async function resolveReference(
  ctx: GraphQLContext,
  target: 'content' | 'asset' | 'user',
  value: unknown,
  list: boolean,
) {
  const ids = list
    ? Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
    : typeof value === 'string'
      ? [value]
      : [];

  if (ids.length === 0) return list ? [] : null;

  const found =
    target === 'user'
      ? await ctx.loaders.user.loadMany(ids)
      : await (target === 'asset' ? ctx.reader.assets(ids) : ctx.reader.byIds(ids)).then(
          (rows: Map<string, unknown>) => ids.map((id) => rows.get(id) ?? null),
        );
  const rows = found.filter((row) => row !== null && !(row instanceof Error));
  return list ? rows : (rows[0] ?? null);
}
