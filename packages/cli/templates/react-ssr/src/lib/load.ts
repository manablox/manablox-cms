import type { ContentNode, ManabloxClient, MenuItem } from '@manablox/public-sdk';

/** Everything one page needs, fetched in one round trip on the server. */
export interface PageData {
  page: ContentNode | null;
  menu: MenuItem[];
}

/**
 * Resolves a URL path to a document and loads the menu beside it. React has no
 * `onServerPrefetch`, so the data is loaded *before* rendering: the server calls this,
 * hands the result to the app, and puts it into the page for the browser to hydrate
 * from. A navigation in the browser calls the same function.
 *
 * `pnpm types` writes `src/manablox.d.ts` from the space's content model; typing
 * `byPermalink` with the generated `Page` turns a renamed field into a compile error.
 */
export async function loadPage(client: ManabloxClient, path: string): Promise<PageData> {
  const [page, menu] = await Promise.all([
    // The SDK strips the slashes; the empty path left for `/` resolves the space's home
    // page, the document starred in the content tree.
    // `expand` inlines the relations the components show, which would otherwise be ids.
    client.byPermalink<ContentNode>(path, { expand: __EXPAND__ }),
    // The "main" menu, as edited in the admin under Menus.
    client.menu('main').then((found) => found?.items ?? []),
  ]);
  return { page, menu };
}
