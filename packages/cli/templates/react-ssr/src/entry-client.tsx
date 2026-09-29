import { hydrateRoot } from 'react-dom/client';
import { App } from './App.js';
import type { AppState } from './lib/state.js';
import './style.css';

declare global {
  interface Window {
    __STATE__?: AppState;
  }
}

const state: AppState = window.__STATE__ ?? {
  config: { url: '__MANABLOX_URL__', editorOrigin: '__EDITOR_ORIGIN__', spaceId: '' },
  path: location.pathname,
  data: null,
};

const root = document.getElementById('app');
if (root) hydrateRoot(root, <App initial={state} />);
