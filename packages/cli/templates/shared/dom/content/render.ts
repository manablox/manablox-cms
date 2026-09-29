import { fieldAttribute } from '@manablox/live-preview';
import { renderBlocks } from '../blocks/render.js';
import { el } from '../dom.js';
import { contentRenderers, type DocumentView } from './index.js';

/**
 * A document, blocks included: the one renderer both routing and the preview canvas go
 * through. A type with a renderer of its own in `./index.ts` uses it; any other renders
 * as a title, the summary and the `components` block field.
 */
export function renderDocument(node: DocumentView & { type: string }): HTMLElement {
  const renderer = contentRenderers[node.type];
  if (renderer) return renderer(node);

  return el(
    'article',
    {},
    el('h1', fieldAttribute(['title']), node.title || 'Untitled'),
    typeof node.fields.summary === 'string' && node.fields.summary
      ? el('p', { class: 'lead', ...fieldAttribute(['summary']) }, node.fields.summary)
      : null,
    renderBlocks(node.fields.components, ['components']),
  );
}
