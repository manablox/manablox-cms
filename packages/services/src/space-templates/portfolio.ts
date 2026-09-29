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

const BLOCKS = SPACE_TEMPLATES.find((entry) => entry.id === 'portfolio')?.blocks ?? [];

const project = (title: string, client: string, year: number, role: string, summary: string) => ({
  title,
  fields: () => ({
    client,
    year,
    role,
    summary,
    body: paragraphs(
      summary,
      'Describe the brief, what you did and how it turned out. Add pictures to the gallery.',
    ),
  }),
});

/** Projects under a Work page, and pages built from sections around a project grid. */
export const portfolioTemplate: SpaceTemplate = {
  types: [
    {
      name: 'project',
      label: 'Project',
      icon: 'briefcase',
      description: 'A piece of work: who it was for, when, your part in it and pictures.',
      fields: [
        { name: 'client', label: 'Client', type: 'string', admin: SIDEBAR },
        {
          name: 'year',
          label: 'Year',
          type: 'number',
          settings: { integer: true, min: 1900, max: 2100 },
          admin: SIDEBAR,
        },
        { name: 'role', label: 'Role', type: 'string', localized: true, admin: SIDEBAR },
        { name: 'cover', label: 'Cover image', type: 'asset', settings: IMAGE, admin: SIDEBAR },
        summaryField,
        {
          name: 'gallery',
          label: 'Gallery',
          type: 'asset',
          settings: { ...IMAGE, multiple: true },
        },
        { name: 'body', label: 'Body', type: 'richtext', localized: true },
      ],
    },
    ...catalogTypes(BLOCKS),
    {
      name: 'project-grid',
      label: 'Project grid',
      kind: 'block',
      icon: 'layout-grid',
      description: 'Picked projects as cards with their cover images.',
      fields: [
        { name: 'headline', label: 'Headline', type: 'string' },
        {
          name: 'projects',
          label: 'Projects',
          type: 'content',
          settings: { types: ['project'], multiple: true },
        },
      ],
    },
    blockPage([...BLOCKS, 'project-grid']),
  ],
  documents: [
    ...catalogSamples(BLOCKS),
    {
      key: 'work',
      type: 'page',
      title: 'Work',
      slug: 'work',
      position: 1,
      fields: ({ block }) => ({
        summary: 'Selected projects.',
        components: blocksOf([
          block('text', {
            headline: 'Work',
            body: paragraphs('Every project lives under this page. Add one from Content.'),
          }),
        ]),
      }),
    },
    {
      key: 'brand-refresh',
      type: 'project',
      slug: 'brand-refresh',
      parent: 'work',
      ...project(
        'Brand refresh',
        'Northwind Coffee',
        2025,
        'Art direction',
        'A new logo, colors and packaging for a small coffee roaster.',
      ),
    },
    {
      key: 'trail-app',
      type: 'project',
      slug: 'trail-app',
      parent: 'work',
      ...project(
        'Trail app',
        'Alpine Club',
        2024,
        'Product design',
        "A mobile app that guides hikers along the club's marked trails.",
      ),
    },
    {
      key: 'city-at-night',
      type: 'project',
      slug: 'city-at-night',
      parent: 'work',
      ...project(
        'City at night',
        'Personal',
        2023,
        'Photography',
        'A photo series about streets after the shops close.',
      ),
    },
    {
      key: 'about',
      type: 'page',
      title: 'About',
      slug: 'about',
      position: 2,
      fields: ({ block }) => ({
        summary: 'Who I am and how I work.',
        components: blocksOf([
          block('hero', { headline: 'About me', subline: 'Designer, maker, photographer.' }),
          block('media-text', {
            headline: 'How I work',
            body: paragraphs(
              'Write about your background, the kind of work you take on and who you have worked with.',
            ),
          }),
          block('quote', {
            quote: 'Good work starts with a good question.',
            author: 'A client',
          }),
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
        summary: 'How to reach me.',
        components: blocksOf([
          refs.block('text', {
            headline: "Let's work together",
            body: paragraphs('Tell visitors how to reach you: an email address, a phone number.'),
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
        summary: `The portfolio of ${refs.space.name}.`,
        components: blocksOf([
          refs.block('hero', {
            headline: refs.space.name,
            subline: 'Design, products and photography.',
          }),
          refs.block('project-grid', {
            headline: 'Selected work',
            projects: [refs.doc('brand-refresh'), refs.doc('trail-app'), refs.doc('city-at-night')],
          }),
          refs.block('gallery', { headline: 'Behind the scenes' }),
          refs.block('call-to-action', {
            ...CATALOG['call-to-action'].sample(refs),
            headline: 'Have a project in mind?',
          }),
        ]),
      }),
    },
  ],
  home: 'home',
  menu: ['home', 'work', 'about', 'contact'],
};
