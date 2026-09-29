import { createClient, type ManabloxClient } from '@manablox/public-sdk';

export interface SiteConfig {
  url: string;
  editorOrigin: string;
  spaceId: string;
}

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
