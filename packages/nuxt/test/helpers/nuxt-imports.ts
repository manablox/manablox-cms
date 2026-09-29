import type { ManabloxPublicConfig } from '../../src/module.js';

/** The Nuxt app and runtime config the stubbed composables return. */
export const nuxt: { app: object; config: ManabloxPublicConfig } = {
  app: {},
  config: {
    url: 'http://localhost:3100',
    spaceId: '',
    locale: 'en',
    transport: 'graphql',
    preview: { enabled: true, route: '/preview', editorOrigin: 'http://localhost:3000' },
  },
};

export const useNuxtApp = () => nuxt.app;
export const useRuntimeConfig = () => ({ public: { manablox: nuxt.config } });
export const useRoute = () => ({ path: '/' });
export const useAsyncData = () => undefined;
export const useState = () => undefined;
