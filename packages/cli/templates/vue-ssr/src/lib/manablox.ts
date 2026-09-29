import { createClient, type ManabloxClient } from '@manablox/public-sdk';
import { inject, type InjectionKey } from 'vue';
import type { SiteConfig } from './state.js';

export const clientKey: InjectionKey<ManabloxClient> = Symbol('manablox');

/** One client per app instance, on REST so no selection sets are needed. */
export function createManablox(config: SiteConfig): ManabloxClient {
  return createClient({
    url: config.url,
    transport: 'rest',
    ...(config.spaceId ? { spaceId: config.spaceId } : {}),
    // Deduplicates the menu request the shell and the page both make during one render.
    cache: { ttl: 30_000 },
  });
}

export function useManablox(): ManabloxClient {
  const client = inject(clientKey);
  if (!client) throw new Error('Manablox client is not provided');
  return client;
}
