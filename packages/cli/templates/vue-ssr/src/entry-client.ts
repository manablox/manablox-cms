import { createApp } from './app.js';
import type { AppState } from './lib/state.js';
import './style.css';

declare global {
  interface Window {
    __STATE__?: AppState;
  }
}

const state: AppState = window.__STATE__ ?? {
  config: { url: '__MANABLOX_URL__', editorOrigin: '__EDITOR_ORIGIN__', spaceId: '' },
  data: {},
};

const { app, router } = createApp(state);
router.isReady().then(() => app.mount('#app'));
