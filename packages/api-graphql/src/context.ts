import { createTouchedIds, type ResponseMeta, type TouchedIds } from '@manablox/cache';
import type { ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import type {
  BlockDelivery,
  ContentService,
  DeliveryReader,
  Loaders,
  MenuService,
} from '@manablox/services';

export { createTouchedIds, type TouchedIds };

export interface GraphQLContext {
  manablox: Manablox;
  repos: Repositories;
  content: ContentService;
  media: MediaService;
  menus: MenuService;
  loaders: Loaders;
  /** Every content read goes through it: hooks, permissions, cache tags. */
  reader: DeliveryReader;
  /** Delivery reads the published projection unless the request is in preview mode. */
  preview: boolean;
  spaceId: string | null;
  /** The request's environment of `spaceId`; production when absent. */
  scope?: ResolvedScope | null;
  /** Plugin block data delivered in `spaceId`; looked up on first use when absent. */
  blockData?: BlockDelivery[];
  /** Present only where a response cache is mounted. */
  touched?: TouchedIds;
  /** Filled by the response cache, read by the HTTP cache middleware. */
  delivery?: ResponseMeta;
}
