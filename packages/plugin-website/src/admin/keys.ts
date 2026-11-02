import { environmentOf, invalidate, pluginKeys } from '@manablox/admin-sdk';

const design = pluginKeys('design');

/** Query keys of the designed site; `all` covers every one of a space. */
export const designKeys = {
  all: design.all,
  list: (spaceId: string | null) => design.scoped(spaceId, 'list'),
  detail: (spaceId: string | null, kind: string, key: string) =>
    design.scoped(spaceId, 'detail', kind, key),
  versions: (spaceId: string | null, id: string | null) => design.scoped(spaceId, 'versions', id),
  domains: (spaceId: string | null) => design.scoped(spaceId, 'domains'),
  many: (spaceId: string | null, kind: string, designKeys: readonly string[]) =>
    design.scoped(spaceId, 'many', kind, ...designKeys),
  usage: (spaceId: string | null, typeId: string, locale: string, term: string) =>
    design.scoped(spaceId, 'usage', typeId, locale, term),
  /** Site mode, revision and the site process origin; under the space, so space writes refresh it. */
  site: (spaceId: string | null) => ['spaces', spaceId, 'site', environmentOf(spaceId)] as const,
};

/** Designs and domains of a designed site. */
export const invalidateDesign = design.invalidate;

/** The site settings of a space, in every environment. */
export function invalidateSiteSettings(spaceId: string | null): void {
  invalidate.own(['spaces', spaceId, 'site']);
}
