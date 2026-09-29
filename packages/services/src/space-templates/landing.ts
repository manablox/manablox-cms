import { SPACE_TEMPLATES } from '@manablox/core';
import { CATALOG, catalogSamples, catalogTypes } from './blocks.js';
import { blockPage, blocksOf, linkTo, type SpaceTemplate } from './shared.js';

const BLOCKS = SPACE_TEMPLATES.find((entry) => entry.id === 'landing')?.blocks ?? [];

/** One strong page for a product, and its prices with the questions around them. */
export const landingTemplate: SpaceTemplate = {
  types: [...catalogTypes(BLOCKS), blockPage([...BLOCKS])],
  documents: [
    ...catalogSamples(BLOCKS),
    {
      key: 'pricing',
      type: 'page',
      title: 'Pricing',
      slug: 'pricing',
      position: 1,
      fields: (refs) => ({
        summary: 'Plans and prices.',
        components: blocksOf([
          refs.block('pricing', CATALOG.pricing.sample(refs)),
          refs.block('faq', CATALOG.faq.sample(refs)),
        ]),
      }),
    },
    {
      key: 'home',
      type: 'page',
      title: 'Home',
      slug: 'home',
      position: 0,
      fields: (refs) => ({
        summary: `Welcome to ${refs.space.name}.`,
        components: blocksOf([
          refs.block('hero', {
            ...CATALOG.hero.sample(refs),
            subline: 'The one sentence that makes people want to try it.',
            button: linkTo(refs.doc('pricing'), 'See the plans'),
          }),
          refs.block('features', CATALOG.features.sample(refs)),
          refs.block('media-text', CATALOG['media-text'].sample(refs)),
          refs.block('stats', CATALOG.stats.sample(refs)),
          refs.block('quote', CATALOG.quote.sample(refs)),
          refs.block('call-to-action', {
            headline: 'Try it today',
            text: 'Start free, upgrade when you need more.',
            button: linkTo(refs.doc('pricing'), 'Choose a plan'),
          }),
        ]),
      }),
    },
  ],
  home: 'home',
  menu: ['home', 'pricing'],
};
