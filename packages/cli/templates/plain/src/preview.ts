import { connectPreview, type PreviewDocument } from '@manablox/live-preview';
import { normaliseFields } from '@manablox/public-sdk';
import { config } from './config.js';
import { el, replace } from './dom.js';
import { renderDocument } from './pages.js';

/**
 * The visual editor's canvas. The origin check is not optional: without it any page could
 * drive the preview. No API key either, because the editor sends the document over the
 * channel rather than this fetching a draft.
 */
export function startPreview(target: HTMLElement): () => void {
  replace(target, el('div', { class: 'state' }, 'Waiting for the editor...'));

  return connectPreview({
    editorOrigin: config.editorOrigin || location.origin,
    clickToEdit: true,
    onDocument: (document: PreviewDocument) => {
      // The editor sends fields in their storage shape, so normalising here is what lets
      // one `renderDocument` serve both the published route and the preview canvas.
      replace(
        target,
        renderDocument({
          type: document.typeName,
          title: document.title,
          fields: normaliseFields(document.fields),
        }),
      );
    },
    onHighlight: (path) => {
      target.setAttribute('data-manablox-highlight', path ? path.join('.') : '');
    },
  });
}
