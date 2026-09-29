import Teaser from './Teaser.astro';

/** What every block component is given: the block, and where it sits in the document. */
export interface BlockProps {
  block: Record<string, unknown>;
  path: (string | number)[];
}

/**
 * The block renderer registry: a `teaser` block renders `<Teaser>`. The same convention
 * the Nuxt module resolves by component name, written as a map.
 */
// Astro types a component as a function of its props returning `any`, and a JSX tag
// needs exactly that; `unknown` would not render.
// biome-ignore lint/suspicious/noExplicitAny: what an Astro component is typed as
export const blockRenderers: Record<string, (props: BlockProps) => any> = {
  teaser: Teaser,
};
