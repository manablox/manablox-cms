/** What a content renderer is given: a published document, or the one the editor sends. */
export interface DocumentView {
  title: string;
  fields: Record<string, unknown>;
}

export type ContentRenderer = (node: DocumentView) => HTMLElement;

/**
 * The content renderer registry: a document whose type is named here renders through its
 * renderer, any other through the generic article in `render.ts`. Empty until a content
 * type gets a renderer of its own; `manablox frontend` fills it from a space's content
 * model when asked to.
 */
export const contentRenderers: Record<string, ContentRenderer> = {};
