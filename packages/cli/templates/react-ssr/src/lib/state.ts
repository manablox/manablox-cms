import type { SiteConfig } from './manablox.js';
import type { PageData } from './load.js';

/** What the server renders from and hands to the browser inside the page. */
export interface AppState {
  config: SiteConfig;
  /** The path that was rendered; the browser starts its router from it. */
  path: string;
  /** `null` on the preview route, which loads nothing from the API. */
  data: PageData | null;
}

export const PREVIEW_PATH = '/preview';
