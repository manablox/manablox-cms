import type { PreviewDocument } from '@manablox/live-preview';
import { type ContentNode, createClient, type ManabloxClient } from '@manablox/public-sdk';
import { useAsyncData, useNuxtApp, useRoute, useRuntimeConfig, useState } from '#imports';
import type { ManabloxPublicConfig } from '../../module';

/** One client per Nuxt app, so per request on the server, keeping its request cache. */
const clients = new WeakMap<object, ManabloxClient>();

/** Delivery client from the module's runtime config. */
export function useManablox(): ManabloxClient {
  const nuxtApp = useNuxtApp();
  let client = clients.get(nuxtApp);
  if (!client) {
    const config = useRuntimeConfig().public.manablox as ManabloxPublicConfig;
    client = createClient({
      url: config.url,
      transport: config.transport ?? 'graphql',
      ...(config.spaceId ? { spaceId: config.spaceId } : {}),
      locale: config.locale,
      ...(config.cache !== undefined ? { cache: config.cache } : {}),
    });
    clients.set(nuxtApp, client);
  }
  return client;
}

export interface ManabloxPageOptions {
  /** GraphQL selection for the type-specific fields; ignored by REST. */
  selection?: string;
  /** Relation and asset fields to inline on REST; GraphQL resolves them anyway. */
  expand?: string[];
}

/**
 * Resolves the current route to a document. A string argument is the selection. Nuxt
 * composables are imported statically: a dynamic import would lose the Nuxt instance
 * across the await.
 */
export function useManabloxPage<T = Record<string, unknown>>(
  options: string | ManabloxPageOptions = {},
) {
  const { selection, expand } = typeof options === 'string' ? { selection: options } : options;
  const route = useRoute();
  const client = useManablox();
  const permalink = route.path.replace(/^\/+|\/+$/g, '');
  const key = `manablox:${permalink || 'index'}${expand?.length ? `:${expand.join(',')}` : ''}`;

  return useAsyncData(key, () =>
    client.byPermalink<T & ContentNode>(permalink, {
      ...(selection ? { selection } : {}),
      ...(expand?.length ? { expand } : {}),
    }),
  );
}

/** The draft `<ManabloxPreview>` receives from the editor; null outside the preview. */
export function useManabloxPreviewState() {
  return useState<PreviewDocument | null>('manablox:preview', () => null);
}
