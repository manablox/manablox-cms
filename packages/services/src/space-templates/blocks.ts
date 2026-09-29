import { randomUUID } from 'node:crypto';
import type { ContentTypeInput, SpaceBlockId } from '@manablox/core';
import {
  IMAGE,
  linkTo,
  paragraphs,
  TEXTAREA,
  type TemplateDocument,
  type TemplateRefs,
} from './shared.js';

/** Data types catalog blocks point at. */
const DATA_TYPES = {
  testimonial: {
    name: 'testimonial',
    label: 'Testimonial',
    kind: 'data',
    icon: 'message-circle',
    description: 'A customer quote, for reuse across pages.',
    fields: [
      {
        name: 'quote',
        label: 'Quote',
        type: 'string',
        required: true,
        localized: true,
        settings: TEXTAREA,
      },
      { name: 'role', label: 'Role', type: 'string', localized: true },
    ],
  },
  'team-member': {
    name: 'team-member',
    label: 'Team member',
    kind: 'data',
    icon: 'id-card',
    description: 'A person on the team, for the About page.',
    fields: [
      { name: 'role', label: 'Role', type: 'string', localized: true },
      { name: 'photo', label: 'Photo', type: 'asset', settings: IMAGE },
      { name: 'bio', label: 'Bio', type: 'string', localized: true, settings: TEXTAREA },
    ],
  },
  message: {
    name: 'message',
    label: 'Message',
    kind: 'data',
    icon: 'mail',
    description: 'What visitors send through the contact form.',
    isPublishable: false,
    fields: [
      { name: 'name', label: 'Name', type: 'string', required: true },
      {
        name: 'email',
        label: 'Email',
        type: 'string',
        required: true,
        settings: { pattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+' },
      },
      { name: 'message', label: 'Message', type: 'string', required: true, settings: TEXTAREA },
    ],
  },
} satisfies Record<string, ContentTypeInput>;

type DataTypeName = keyof typeof DATA_TYPES;

/** A catalog block: its type, the data types it needs and a filled example. */
export interface CatalogBlock {
  type: ContentTypeInput;
  needs?: DataTypeName[];
  /** Example field values; `refs` points at the sample entries of the needed data types. */
  sample: (refs: TemplateRefs) => Record<string, unknown>;
}

/** Repeater items with fresh ids. */
const items = (...entries: Array<Record<string, unknown>>) =>
  entries.map((fields) => ({ itemId: randomUUID(), fields }));

const repeater = (name: string, label: string, fields: ContentTypeInput['fields']) => ({
  name,
  label,
  type: 'repeater',
  settings: { fields },
});

const headline = { name: 'headline', label: 'Headline', type: 'string' };

export const CATALOG: Record<SpaceBlockId, CatalogBlock> = {
  hero: {
    type: {
      name: 'hero',
      label: 'Hero',
      kind: 'block',
      icon: 'panels-top-left',
      description: 'The big opener at the top of a page.',
      fields: [
        { ...headline, required: true },
        { name: 'subline', label: 'Subline', type: 'string' },
        { name: 'image', label: 'Image', type: 'asset', settings: IMAGE },
        { name: 'button', label: 'Button', type: 'link' },
      ],
    },
    sample: ({ space }) => ({ headline: space.name, subline: 'Say in one line what you do best.' }),
  },
  text: {
    type: {
      name: 'text',
      label: 'Text',
      kind: 'block',
      icon: 'notebook-text',
      description: 'A section of text under an optional headline.',
      fields: [headline, { name: 'body', label: 'Body', type: 'richtext' }],
    },
    sample: () => ({
      headline: 'About us',
      body: paragraphs(
        'Tell your story in a few sentences: who you are, what you do and why it matters.',
      ),
    }),
  },
  'media-text': {
    type: {
      name: 'media-text',
      label: 'Image and text',
      kind: 'block',
      icon: 'split',
      description: 'Text with a picture beside it and an optional button.',
      fields: [
        { ...headline, required: true },
        { name: 'body', label: 'Body', type: 'richtext' },
        { name: 'image', label: 'Image', type: 'asset', settings: IMAGE },
        { name: 'button', label: 'Button', type: 'link' },
      ],
    },
    sample: () => ({
      headline: 'How it works',
      body: paragraphs(
        'Show one thing at a time: a picture on one side, a short text on the other.',
      ),
    }),
  },
  image: {
    type: {
      name: 'image',
      label: 'Image',
      kind: 'block',
      icon: 'image',
      description: 'One large picture with a caption.',
      fields: [
        { name: 'image', label: 'Image', type: 'asset', settings: IMAGE },
        { name: 'caption', label: 'Caption', type: 'string' },
      ],
    },
    sample: () => ({ caption: 'A picture says more than a paragraph.' }),
  },
  gallery: {
    type: {
      name: 'gallery',
      label: 'Gallery',
      kind: 'block',
      icon: 'images',
      description: 'Several pictures in a grid.',
      fields: [
        headline,
        { name: 'images', label: 'Images', type: 'asset', settings: { ...IMAGE, multiple: true } },
      ],
    },
    sample: () => ({ headline: 'Impressions' }),
  },
  quote: {
    type: {
      name: 'quote',
      label: 'Quote',
      kind: 'block',
      icon: 'quote',
      description: 'One highlighted statement and who said it.',
      fields: [
        { name: 'quote', label: 'Quote', type: 'string', required: true, settings: TEXTAREA },
        { name: 'author', label: 'Author', type: 'string' },
        { name: 'role', label: 'Role', type: 'string' },
      ],
    },
    sample: () => ({
      quote: 'Simple things, done really well. That is all we ever wanted.',
      author: 'Lena M.',
      role: 'Customer since day one',
    }),
  },
  features: {
    type: {
      name: 'features',
      label: 'Features',
      kind: 'block',
      icon: 'list-checks',
      description: 'Short points with a title and a sentence each.',
      fields: [
        headline,
        { name: 'intro', label: 'Intro', type: 'string', settings: TEXTAREA },
        repeater('items', 'Items', [
          { name: 'title', label: 'Title', type: 'string', required: true },
          { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
        ]),
      ],
    },
    sample: () => ({
      headline: 'Why people choose us',
      intro: 'Three reasons, in one sentence each.',
      items: items(
        { title: 'Quick to start', text: 'Up and running in an afternoon, not a month.' },
        { title: 'Easy to change', text: 'Everything can be edited later, by anyone on the team.' },
        { title: 'Made to last', text: 'Built on solid ground and looked after for years.' },
      ),
    }),
  },
  stats: {
    type: {
      name: 'stats',
      label: 'Numbers',
      kind: 'block',
      icon: 'chart-column',
      description: 'A few key figures with labels.',
      fields: [
        headline,
        repeater('items', 'Figures', [
          { name: 'value', label: 'Value', type: 'string', required: true },
          { name: 'label', label: 'Label', type: 'string', required: true },
        ]),
      ],
    },
    sample: () => ({
      headline: 'In numbers',
      items: items(
        { value: '12', label: 'Years of experience' },
        { value: '350+', label: 'Happy customers' },
        { value: '24 h', label: 'Average reply time' },
      ),
    }),
  },
  faq: {
    type: {
      name: 'faq',
      label: 'FAQ',
      kind: 'block',
      icon: 'circle-help',
      description: 'Questions and their answers.',
      fields: [
        headline,
        repeater('items', 'Questions', [
          { name: 'question', label: 'Question', type: 'string', required: true },
          { name: 'answer', label: 'Answer', type: 'string', settings: TEXTAREA },
        ]),
      ],
    },
    sample: () => ({
      headline: 'Questions and answers',
      items: items(
        { question: 'How do we start?', answer: 'Send us a message and we set up a short call.' },
        {
          question: 'What does it cost?',
          answer: 'That depends on what you need; the first talk is free.',
        },
        { question: 'Can I change things later?', answer: 'Yes, everything stays yours to edit.' },
      ),
    }),
  },
  pricing: {
    type: {
      name: 'pricing',
      label: 'Pricing',
      kind: 'block',
      icon: 'tags',
      description: 'Plans with a price, what they include and a button.',
      fields: [
        headline,
        { name: 'intro', label: 'Intro', type: 'string', settings: TEXTAREA },
        repeater('plans', 'Plans', [
          { name: 'name', label: 'Name', type: 'string', required: true },
          { name: 'price', label: 'Price', type: 'string', required: true },
          { name: 'period', label: 'Period', type: 'string' },
          { name: 'features', label: 'What is included', type: 'string', settings: TEXTAREA },
          { name: 'button', label: 'Button', type: 'link' },
        ]),
      ],
    },
    sample: () => ({
      headline: 'Pricing',
      intro: 'Pick the plan that fits; switch any time.',
      plans: items(
        {
          name: 'Starter',
          price: '9 EUR',
          period: 'per month',
          features: 'One project. Email support.',
        },
        {
          name: 'Team',
          price: '29 EUR',
          period: 'per month',
          features: 'Ten projects. Priority support.',
        },
        {
          name: 'Business',
          price: '79 EUR',
          period: 'per month',
          features: 'Unlimited projects. A personal contact.',
        },
      ),
    }),
  },
  testimonials: {
    type: {
      name: 'testimonials',
      label: 'Testimonials',
      kind: 'block',
      icon: 'message-square',
      description: 'Picked customer quotes.',
      fields: [
        headline,
        {
          name: 'items',
          label: 'Testimonials',
          type: 'content',
          settings: { types: ['testimonial'], multiple: true },
        },
      ],
    },
    needs: ['testimonial'],
    sample: ({ doc }) => ({
      headline: 'What customers say',
      items: [doc('quote-1'), doc('quote-2')],
    }),
  },
  team: {
    type: {
      name: 'team',
      label: 'Team',
      kind: 'block',
      icon: 'users',
      description: 'Picked team members with photo and role.',
      fields: [
        headline,
        {
          name: 'members',
          label: 'Members',
          type: 'content',
          settings: { types: ['team-member'], multiple: true },
        },
      ],
    },
    needs: ['team-member'],
    sample: ({ doc }) => ({ headline: 'The team', members: [doc('anna'), doc('david')] }),
  },
  contact: {
    type: {
      name: 'contact',
      label: 'Contact form',
      kind: 'block',
      icon: 'mail',
      description: 'A form whose messages are stored as entries.',
      fields: [
        headline,
        { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
        {
          name: 'form',
          label: 'Stores in',
          type: 'databag',
          required: true,
          settings: { types: ['message'] },
        },
      ],
    },
    needs: ['message'],
    sample: ({ type }) => ({
      headline: 'Write to us',
      text: 'We answer within one working day.',
      form: type('message'),
    }),
  },
  'call-to-action': {
    type: {
      name: 'call-to-action',
      label: 'Call to action',
      kind: 'block',
      icon: 'megaphone',
      description: 'A short pitch with one button.',
      fields: [
        { ...headline, required: true },
        { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
        { name: 'button', label: 'Button', type: 'link' },
      ],
    },
    sample: ({ doc, hasDoc }) => ({
      headline: 'Ready to start?',
      text: 'Tell us about your project.',
      ...(hasDoc('contact') ? { button: linkTo(doc('contact'), 'Contact us') } : {}),
    }),
  },
};

/** Sample entries of the data types, created before the pages. */
const DATA_SAMPLES: Record<DataTypeName, TemplateDocument[]> = {
  testimonial: [
    {
      key: 'quote-1',
      type: 'testimonial',
      title: 'Maria K.',
      fields: () => ({ quote: 'Friendly, fast and exactly what we needed.', role: 'Shop owner' }),
    },
    {
      key: 'quote-2',
      type: 'testimonial',
      title: 'Tom R.',
      fields: () => ({
        quote: 'They explained every step and finished ahead of plan.',
        role: 'Office manager',
      }),
    },
  ],
  'team-member': [
    {
      key: 'anna',
      type: 'team-member',
      title: 'Anna Berger',
      fields: () => ({ role: 'Founder', bio: 'Started the company and still answers every call.' }),
    },
    {
      key: 'david',
      type: 'team-member',
      title: 'David Novak',
      fields: () => ({ role: 'Project lead', bio: 'Keeps projects on time and customers happy.' }),
    },
  ],
  message: [],
};

/** Catalog order, so pages list their blocks the same way everywhere. */
export function catalogOrder(blocks: readonly SpaceBlockId[]): SpaceBlockId[] {
  const wanted = new Set(blocks);
  return (Object.keys(CATALOG) as SpaceBlockId[]).filter((id) => wanted.has(id));
}

/** The data types and block types of these blocks, data types first. */
export function catalogTypes(blocks: readonly SpaceBlockId[]): ContentTypeInput[] {
  const ordered = catalogOrder(blocks);
  const data = new Set(ordered.flatMap((id) => CATALOG[id].needs ?? []));
  return [...[...data].map((name) => DATA_TYPES[name]), ...ordered.map((id) => CATALOG[id].type)];
}

/** The sample entries the blocks point at. */
export function catalogSamples(blocks: readonly SpaceBlockId[]): TemplateDocument[] {
  const data = new Set(catalogOrder(blocks).flatMap((id) => CATALOG[id].needs ?? []));
  return [...data].flatMap((name) => DATA_SAMPLES[name]);
}

/** One block of each, filled with its example. */
export function catalogBlocks(refs: TemplateRefs, blocks: readonly SpaceBlockId[]) {
  return catalogOrder(blocks).map((id) => refs.block(id, CATALOG[id].sample(refs)));
}
