import { connectPreview } from '@manablox/live-preview';
import { normaliseFields } from '@manablox/public-sdk';
import { renderDocument } from './preview/content/render.js';

/**
 * The preview canvas renders in the browser, so it cannot use the server-only `.astro`
 * components. The document arrives over the channel on every keystroke, which is why a
 * client-side renderer is the right shape here: `./preview/` mirrors `components/` as
 * functions returning elements, one per block and content type.
 */
export function startPreview(target: HTMLElement, editorOrigin: string): () => void {
  target.textContent = 'Waiting for the editor...';

  return connectPreview({
    editorOrigin: editorOrigin || location.origin,
    clickToEdit: true,
    onDocument: (document) => {
      // The editor sends fields in their *storage* shape, so blocks arrive as
      // `{ blockId, type, fields }` rather than the flattened form the SDK returns; the
      // grid travels inside the value.
      target.replaceChildren(
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
