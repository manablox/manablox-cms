import type { ContentNode, ManabloxClient, MenuItem } from '@manablox/public-sdk';
import { el } from './dom.js';

// A document renders through `content/render.ts`, which the preview canvas shares.
export { renderDocument } from './content/render.js';

/** A list of children, for a section landing page. */
export async function renderListing(
  client: ManabloxClient,
  parent: ContentNode,
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  const children = await client.list({ under: parent.id, limit: 20 }, { signal });
  if (children.items.length === 0) return null;

  return el(
    'ul',
    { class: 'listing' },
    ...children.items.map((child) =>
      el(
        'li',
        {},
        el('a', { href: `/${child.permalink ?? ''}` }, child.title),
        typeof child.fields.summary === 'string'
          ? el('p', { class: 'lead' }, child.fields.summary)
          : null,
      ),
    ),
  );
}

export function renderMenu(items: MenuItem[], currentPath: string): HTMLElement[] {
  return items.map((item) => {
    const href = item.href ?? '#';
    // An entry set to open in a new tab carries the target the editor chose; `noreferrer`
    // goes with it, since such an entry usually leaves the site.
    const newTab = item.target === '_blank';
    return el(
      'a',
      {
        href,
        ...(href === currentPath ? { 'aria-current': 'page' } : {}),
        ...(newTab ? { target: '_blank', rel: 'noreferrer' } : {}),
      },
      item.label,
    );
  });
}

export function renderNotFound(path: string): HTMLElement {
  return el(
    'div',
    { class: 'state' },
    el('h1', {}, 'Not found'),
    el('p', {}, `Nothing is published at ${path}.`),
    el('p', {}, el('a', { href: '/' }, 'Back to the start')),
  );
}

export function renderError(error: unknown): HTMLElement {
  return el(
    'div',
    { class: 'state' },
    el('h1', {}, 'Something went wrong'),
    // "The CMS is down" and "this page does not exist" are different answers, and the
    // SDK's typed errors are what makes telling them apart possible.
    el('p', {}, error instanceof Error ? error.message : String(error)),
  );
}
