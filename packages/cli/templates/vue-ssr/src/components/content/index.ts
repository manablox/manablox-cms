import type { Component } from 'vue';

/** What a content component is given: a published document, or the one the editor sends. */
export interface DocumentView {
  title: string;
  fields: Record<string, unknown>;
}

/**
 * The content component registry: a document whose type is named here renders through
 * its component, taking the document as `node`; any other renders as the generic article
 * in `pages/Page.vue`. Empty until a content type gets a component of its own;
 * `manablox frontend` fills it from a space's content model when asked to.
 */
export const contentRenderers: Record<string, Component> = {};
