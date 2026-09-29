import type { Manablox } from './manablox.node.js';

/** Drops cached deliveries carrying any of `tags`. */
export function purgeTags(
  manablox: Manablox,
  spaceId: string | null,
  tags: string[],
): Promise<unknown> {
  return manablox.hooks.run('cache:purge', { tags }, { manablox, spaceId });
}
