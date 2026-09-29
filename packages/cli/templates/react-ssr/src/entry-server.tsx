import { BLOCK_GRID_CSS } from '@manablox/public-sdk';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';
import { loadPage } from './lib/load.js';
import { createManablox, type SiteConfig } from './lib/manablox.js';
import { type AppState, PREVIEW_PATH } from './lib/state.js';

export interface RenderResult {
  html: string;
  head: string;
  status: number;
}

/**
 * Renders one URL to a string. React has no server prefetch hook, so the data is loaded
 * first and rendering is synchronous: what the app receives is what the browser will
 * hydrate from.
 */
export async function render(url: string, config: SiteConfig): Promise<RenderResult> {
  const path = new URL(url, 'http://localhost').pathname;
  const preview = path === PREVIEW_PATH;

  // A failure here propagates: `server.js` answers 503 rather than serving an empty page
  // that a cache could keep. "The CMS is down" is not a 404.
  const data = preview ? null : await loadPage(createManablox(config), path);
  const state: AppState = { config, path, data };

  const html = renderToString(<App initial={state} />);

  // The state travels in the page. `<` is escaped so content cannot close the script.
  const serialised = JSON.stringify(state).replace(/</g, '\\u003c');
  const title = preview ? 'Preview' : (data?.page?.title ?? 'Not found');
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    preview ? '<meta name="robots" content="noindex" />' : '',
    // What turns a block's layout custom properties into a CSS grid. It travels in the
    // rendered head, so the grid is laid out before any stylesheet loads, and it comes
    // from the SDK rather than a copy here, which could drift from the properties the
    // components set.
    `<style>${BLOCK_GRID_CSS}</style>`,
    `<script>window.__STATE__=${serialised}</script>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { html, head, status: preview || data?.page ? 200 : 404 };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character,
  );
}
