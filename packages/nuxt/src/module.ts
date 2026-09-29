import type { CacheOptions } from '@manablox/public-sdk';
import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit';
import type { NuxtModule } from '@nuxt/schema';

export interface ManabloxModuleOptions {
  /** The public delivery API. */
  url?: string;
  /** Required against a management API; a public API pins its own space. */
  spaceId?: string;
  locale?: string;
  /** `graphql` selects exact fields; `rest` needs no selection sets but only a public API serves it. */
  transport?: 'graphql' | 'rest';
  /** Server-only runtime config, for server code of your own; nothing here reads it. */
  apiKey?: string;
  /** `editorOrigin` is the admin's origin, the only sender the preview accepts. */
  preview?: { enabled?: boolean; route?: string; editorOrigin?: string };
  /** The client's request cache; `false` keeps only in-flight deduplication. */
  cache?: CacheOptions | false;
}

/** The options as `runtimeConfig.public.manablox` holds them, defaults applied. */
export type ManabloxPublicConfig = Required<
  Omit<ManabloxModuleOptions, 'apiKey' | 'preview' | 'cache'>
> &
  Pick<ManabloxModuleOptions, 'cache'> & {
    preview: Required<NonNullable<ManabloxModuleOptions['preview']>>;
  };

/** Nuxt module for Manablox-backed frontends. */
const module: NuxtModule<ManabloxModuleOptions> = defineNuxtModule<ManabloxModuleOptions>({
  meta: {
    name: '@manablox/nuxt',
    configKey: 'manablox',
    compatibility: { nuxt: '>=4.0.0' },
  },

  // Matches the ports of a `manablox create` project.
  defaults: {
    url: process.env.MANABLOX_URL || 'http://localhost:3100',
    spaceId: process.env.MANABLOX_SPACE_ID || '',
    preview: {
      enabled: true,
      route: '/preview',
      editorOrigin: process.env.MANABLOX_ADMIN_ORIGIN || 'http://localhost:3000',
    },
  },

  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // Public config reaches the browser; the API key never does.
    const publicConfig: ManabloxPublicConfig = {
      url: options.url ?? '',
      spaceId: options.spaceId ?? '',
      locale: options.locale ?? 'en',
      transport: options.transport ?? 'graphql',
      preview: {
        enabled: options.preview?.enabled ?? true,
        route: options.preview?.route ?? '/preview',
        editorOrigin: options.preview?.editorOrigin ?? '',
      },
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
    };
    nuxt.options.runtimeConfig.public.manablox = publicConfig;

    nuxt.options.runtimeConfig.manablox = { apiKey: options.apiKey ?? '' };

    addImportsDir(resolver.resolve('./runtime/composables'));
    void addComponentsDir({
      path: resolver.resolve('./runtime/components'),
      global: true,
      prefix: 'Manablox',
    });
  },
});

export default module;
