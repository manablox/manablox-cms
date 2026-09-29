import { inject, type InjectionKey } from 'vue';

export interface SiteConfig {
  url: string;
  editorOrigin: string;
  spaceId: string;
}

export interface AppState {
  config: SiteConfig;
  /** Loaded data, keyed by `useLoad`: filled on the server, read once in the browser. */
  data: Record<string, unknown>;
}

export const stateKey: InjectionKey<AppState> = Symbol('state');

export function useState(): AppState {
  const state = inject(stateKey);
  if (!state) throw new Error('App state is not provided');
  return state;
}
