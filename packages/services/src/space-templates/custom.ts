import { DEFAULT_SPACE_BLOCKS, type SpaceBlockId } from '@manablox/core';
import { catalogBlocks, catalogOrder, catalogSamples, catalogTypes } from './blocks.js';
import { blockPage, blocksOf, type SpaceTemplate, type TemplateRefs } from './shared.js';

/**
 * A space built from picked catalog blocks: a home page with one of each, filled with
 * examples, and a contact page when the contact form is among them.
 */
export function customTemplate(
  picked: readonly SpaceBlockId[] = DEFAULT_SPACE_BLOCKS,
): SpaceTemplate {
  const blocks = catalogOrder(picked.length ? picked : DEFAULT_SPACE_BLOCKS);
  const contactPage = blocks.includes('contact') && blocks.length > 1;
  const onHome = contactPage ? blocks.filter((id) => id !== 'contact') : blocks;
  return {
    types: [...catalogTypes(blocks), blockPage(blocks)],
    documents: [
      ...catalogSamples(blocks),
      ...(contactPage
        ? [
            {
              key: 'contact',
              type: 'page',
              title: 'Contact',
              slug: 'contact',
              position: 1,
              fields: (refs: TemplateRefs) => ({
                summary: 'How to reach us.',
                components: blocksOf(catalogBlocks(refs, ['contact'])),
              }),
            },
          ]
        : []),
      {
        key: 'home',
        type: 'page',
        title: 'Home',
        slug: 'home',
        position: 0,
        fields: (refs) => ({
          summary: `Welcome to ${refs.space.name}.`,
          components: blocksOf(catalogBlocks(refs, onHome)),
        }),
      },
    ],
    home: 'home',
    menu: contactPage ? ['home', 'contact'] : ['home'],
  };
}
