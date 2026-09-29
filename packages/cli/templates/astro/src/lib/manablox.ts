import { createClient, type ManabloxClient } from '@manablox/public-sdk';

/**
 * Read from `process.env`, not `import.meta.env`: these are server only, so they stay out
 * of the client bundle and resolve per process, letting one build run anywhere.
 */
export const config = {
  url: process.env.MANABLOX_URL ?? '__MANABLOX_URL__',
  /** The visual editor's origin, for the preview channel's origin check. */
  editorOrigin: process.env.MANABLOX_ADMIN_ORIGIN ?? '__EDITOR_ORIGIN__',
  /** Only meaningful against a management instance; a public one pins its own space. */
  spaceId: process.env.MANABLOX_SPACE_ID || undefined,
};

let client: ManabloxClient | undefined;

/** One client per process; the SDK dedupes and caches reads behind it. */
export function manablox(): ManabloxClient {
  client ??= createClient({
    url: config.url,
    // REST needs no selection sets, so this renders any content model as it is. Switch
    // to the default GraphQL transport when you want to select fields per page.
    transport: 'rest',
    ...(config.spaceId ? { spaceId: config.spaceId } : {}),
    // Deduplicates the menu request the shell and the page both make during one render.
    cache: { ttl: 30_000 },
  });
  return client;
}
