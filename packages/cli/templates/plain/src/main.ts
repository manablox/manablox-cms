import { BLOCK_GRID_CSS, createClient, ManabloxAbortError } from '@manablox/public-sdk';
import { config } from './config.js';
import { replace } from './dom.js';
import { renderDocument, renderError, renderListing, renderMenu, renderNotFound } from './pages.js';
import { startPreview } from './preview.js';
import { createRouter } from './router.js';

/**
 * The whole application. REST rather than GraphQL, because an app without query tooling
 * has no comfortable way to write selection sets; the same SDK serves both.
 */
// The SDK's grid stylesheet: what turns a block's layout custom properties into CSS grid.
document.head.appendChild(
  Object.assign(document.createElement('style'), { textContent: BLOCK_GRID_CSS }),
);

const client = createClient({
  url: config.url,
  transport: 'rest',
  ...(config.spaceId ? { spaceId: config.spaceId } : {}),
  // Deduplicates the menu request the shell and the page both trigger.
  cache: { ttl: 30_000 },
});

const app = document.querySelector('#app') as HTMLElement;
const menu = document.querySelector('#menu') as HTMLElement;

async function renderRoute(path: string, signal: AbortSignal): Promise<void> {
  if (path === config.previewPath) {
    replace(menu);
    startPreview(app);
    return;
  }

  replace(
    app,
    Object.assign(document.createElement('div'), {
      className: 'state',
      textContent: 'Loading...',
    }),
  );

  try {
    const [page, menuItems] = await Promise.all([
      // `pnpm types` writes `src/manablox.d.ts` from the space's content model; typing
      // this call with the generated `Page` turns a renamed field into a compile error.
      // `expand` inlines the relations the renderers show, which would otherwise be ids.
      client.byPermalink(path, { signal, expand: __EXPAND__ }),
      // The "main" menu, as edited in the admin under Menus.
      client.menu('main', { signal }),
    ]);

    replace(menu, ...renderMenu(menuItems?.items ?? [], path));

    if (!page) {
      replace(app, renderNotFound(path));
      return;
    }

    document.title = page.title;
    const listing = await renderListing(client, page, signal);
    replace(app, renderDocument(page), listing);
  } catch (error) {
    // A navigation that superseded this one is not a failure to report.
    if (error instanceof ManabloxAbortError || signal.aborted) return;
    replace(app, renderError(error));
  }
}

createRouter(renderRoute).start();
