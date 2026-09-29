/** What a content component is given: a published document, or the one the editor sends. */
export interface DocumentView {
  title: string;
  fields: Record<string, unknown>;
}

/**
 * The content component registry: a document whose type is named here renders through
 * its component, any other as the generic article in `pages/[...slug].astro`. Empty
 * until a content type gets a component of its own; `manablox frontend` fills it from a
 * space's content model when asked to.
 */
// biome-ignore lint/suspicious/noExplicitAny: what an Astro component is typed as
export const contentRenderers: Record<string, (props: { node: DocumentView }) => any> = {};
