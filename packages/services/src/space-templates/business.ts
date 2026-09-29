import { SPACE_TEMPLATES } from '@manablox/core';
import { CATALOG, catalogSamples, catalogTypes } from './blocks.js';
import {
  blockPage,
  blocksOf,
  IMAGE,
  paragraphs,
  SIDEBAR,
  type SpaceTemplate,
  summaryField,
} from './shared.js';

const BLOCKS = SPACE_TEMPLATES.find((entry) => entry.id === 'business')?.blocks ?? [];

const service = (key: string, title: string, summary: string) => ({
  key,
  type: 'service',
  title,
  slug: key,
  parent: 'services',
  fields: () => ({
    summary,
    body: paragraphs(summary, 'Explain what is included, how it works and what it costs.'),
  }),
});

/** Services, a team, testimonials, questions and a contact form on pages built from sections. */
export const businessTemplate: SpaceTemplate = {
  types: [
    {
      name: 'service',
      label: 'Service',
      icon: 'wrench',
      description: 'Something the company offers, with its own page.',
      fields: [
        { name: 'image', label: 'Image', type: 'asset', settings: IMAGE, admin: SIDEBAR },
        summaryField,
        { name: 'body', label: 'Body', type: 'richtext', localized: true },
      ],
    },
    ...catalogTypes(BLOCKS),
    {
      name: 'service-list',
      label: 'Service list',
      kind: 'block',
      icon: 'layout-grid',
      description: 'Picked services as cards that link to their pages.',
      fields: [
        { name: 'headline', label: 'Headline', type: 'string' },
        {
          name: 'services',
          label: 'Services',
          type: 'content',
          settings: { types: ['service'], multiple: true },
        },
      ],
    },
    blockPage([...BLOCKS, 'service-list']),
  ],
  documents: [
    ...catalogSamples(BLOCKS),
    {
      key: 'services',
      type: 'page',
      title: 'Services',
      slug: 'services',
      position: 1,
      fields: (refs) => ({
        summary: 'What we offer.',
        components: blocksOf([
          refs.block('hero', { headline: 'Services', subline: 'Everything we can do for you.' }),
          refs.block('faq', CATALOG.faq.sample(refs)),
        ]),
      }),
    },
    service(
      'consulting',
      'Consulting',
      'We look at where you are and plan the next steps with you.',
    ),
    service(
      'implementation',
      'Implementation',
      'We build it, test it and hand it over ready to use.',
    ),
    service('support', 'Support', 'We stay around after launch and fix what comes up.'),
    {
      key: 'about',
      type: 'page',
      title: 'About',
      slug: 'about',
      position: 2,
      fields: (refs) => ({
        summary: `Who is behind ${refs.space.name}.`,
        components: blocksOf([
          refs.block('text', {
            headline: 'About us',
            body: paragraphs('Tell the story of the company: when it started, what drives it.'),
          }),
          refs.block('stats', CATALOG.stats.sample(refs)),
          refs.block('team', CATALOG.team.sample(refs)),
        ]),
      }),
    },
    {
      key: 'contact',
      type: 'page',
      title: 'Contact',
      slug: 'contact',
      position: 3,
      fields: (refs) => ({
        summary: 'How to reach us.',
        components: blocksOf([
          refs.block('text', {
            headline: 'Get in touch',
            body: paragraphs('Add your address, phone number, email and opening hours.'),
          }),
          refs.block('contact', CATALOG.contact.sample(refs)),
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
          refs.block('hero', CATALOG.hero.sample(refs)),
          refs.block('features', CATALOG.features.sample(refs)),
          refs.block('service-list', {
            headline: 'What we do',
            services: [refs.doc('consulting'), refs.doc('implementation'), refs.doc('support')],
          }),
          refs.block('testimonials', CATALOG.testimonials.sample(refs)),
          refs.block('call-to-action', CATALOG['call-to-action'].sample(refs)),
        ]),
      }),
    },
  ],
  home: 'home',
  menu: ['home', 'services', 'about', 'contact'],
};
