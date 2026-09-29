import { createSSRApp } from 'vue';
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { clientKey, createManablox } from './lib/manablox.js';
import { type AppState, stateKey } from './lib/state.js';

/** Server and browser build the same app; only the history and the mount differ. */
export function createApp(state: AppState) {
  const app = createSSRApp(App);

  const router = createRouter({
    // The server has no address bar; memory history takes the URL from `push()`.
    history: import.meta.env.SSR ? createMemoryHistory() : createWebHistory(),
    routes: [
      { path: '/preview', component: () => import('./pages/Preview.vue') },
      // Everything else is a permalink the CMS resolves.
      { path: '/:permalink(.*)*', component: () => import('./pages/Page.vue') },
    ],
  });

  app.use(router);
  app.provide(stateKey, state);
  app.provide(clientKey, createManablox(state.config));

  return { app, router };
}
