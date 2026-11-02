import type { DesignNode, SiteRenderInput } from '@manablox/site';
import { Window } from 'happy-dom';
import { renderSitePage } from '../src/page.js';
import type { RenderOptions } from '../src/types.js';
import { pageWith, renderInput } from './fixtures.js';

const window = new Window();

export function parse(html: string): Document {
  return new window.DOMParser().parseFromString(html, 'text/html') as unknown as Document;
}

/** A layout that is only the slot, so the page body is all there is. */
export const bareLayout = { key: 'bare', design: { root: { id: 'slot', el: 'slot' as const } } };

/** Renders `nodes` as the page body and returns the parsed document and the HTML. */
export async function renderNodes(
  nodes: DesignNode[],
  overrides: Partial<SiteRenderInput> = {},
  options: RenderOptions = {},
) {
  const result = await renderSitePage(
    renderInput({ page: pageWith(...nodes), layout: bareLayout, ...overrides }),
    { now: 1000, ...options },
  );
  return { ...result, doc: parse(result.html) };
}
