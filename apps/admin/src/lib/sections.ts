import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** Whether the route belongs to the sidebar entry `to`: its `meta.section`, else a path prefix. */
export function isSectionActive(
  route: Pick<RouteLocationNormalizedLoaded, 'path' | 'meta'>,
  to: string,
): boolean {
  if (route.meta.section !== undefined) return route.meta.section === to;
  return to === '/' ? route.path === '/' : route.path.startsWith(to);
}
