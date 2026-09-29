import type { TouchedIds } from '@manablox/cache';
import type { ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import type { DeliveryReader, Loaders, MenuService } from '@manablox/services';

/** Delivery context; it has no write services, so procedures cannot write. */
export interface PublicContext {
  manablox: Manablox;
  repos: Repositories;
  media: MediaService;
  menus: MenuService;
  loaders: Loaders;
  /** Every content read goes through it: hooks, permissions, cache tags. */
  reader: DeliveryReader;
  /** Pinned space; never taken from the request. */
  spaceId: string;
  /** The space's environment the request reads; production when absent. */
  scope?: ResolvedScope | null | undefined;
  /** Present only where a response cache is mounted. */
  touched?: TouchedIds;
  /** Expanded documents carry their fields, assets inlined, one level deep; for the site. */
  relatedFields?: boolean;
}
