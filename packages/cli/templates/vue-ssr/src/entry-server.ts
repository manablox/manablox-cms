import { BLOCK_GRID_CSS } from '@manablox/public-sdk';
import { renderToString, type SSRContext } from 'vue/server-renderer';
import { createApp } from './app.js';
import type { AppState, SiteConfig } from './lib/state.js';

export interface RenderResult {
  html: string;
  head: string;
  status: number;
}

/** Renders one URL to a string. The page components set the status and the title on the context. */
export async function render(url: string, config: SiteConfig): Promise<RenderResult> {
  const state: AppState = { config, data: {} };
  const { app, router } = createApp(state);

  await router.push(url);
  await router.isReady();

  const ctx: SSRContext & { status?: number; title?: string } = {};
  const html = await renderToString(app, ctx);

  // The state travels in the page. `<` is escaped so content cannot close the script.
  const serialised = JSON.stringify(state).replace(/</g, '\\u003c');
  const head = [
    `<title>${escapeHtml(ctx.title ?? '__NAME__')}</title>`,
    // What turns a block's layout custom properties into a CSS grid. It travels in the
    // rendered head, so the grid is laid out before any stylesheet loads, and it comes
    // from the SDK rather than a copy here, which could drift from the properties the
    // components set.
    `<style>${BLOCK_GRID_CSS}</style>`,
    `<script>window.__STATE__=${serialised}</script>`,
  ].join('\n');

  return { html, head, status: ctx.status ?? 200 };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character,
  );
}
