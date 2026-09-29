/** Block types a new space can start with; website types pick from them, `custom` lets you pick. */
export const SPACE_BLOCKS = [
  {
    id: 'hero',
    name: 'Hero',
    icon: 'panels-top-left',
    description: 'The big opener at the top of a page.',
  },
  {
    id: 'text',
    name: 'Text',
    icon: 'notebook-text',
    description: 'A section of text under an optional headline.',
  },
  {
    id: 'media-text',
    name: 'Image and text',
    icon: 'split',
    description: 'Text with a picture beside it and an optional button.',
  },
  { id: 'image', name: 'Image', icon: 'image', description: 'One large picture with a caption.' },
  { id: 'gallery', name: 'Gallery', icon: 'images', description: 'Several pictures in a grid.' },
  {
    id: 'quote',
    name: 'Quote',
    icon: 'quote',
    description: 'One highlighted statement and who said it.',
  },
  {
    id: 'features',
    name: 'Features',
    icon: 'list-checks',
    description: 'Short points with a title and a sentence each.',
  },
  {
    id: 'stats',
    name: 'Numbers',
    icon: 'chart-column',
    description: 'A few key figures with labels.',
  },
  { id: 'faq', name: 'FAQ', icon: 'circle-help', description: 'Questions and their answers.' },
  {
    id: 'pricing',
    name: 'Pricing',
    icon: 'tags',
    description: 'Plans with a price, what they include and a button.',
  },
  {
    id: 'testimonials',
    name: 'Testimonials',
    icon: 'message-square',
    description: 'Customer quotes, kept as reusable entries.',
  },
  {
    id: 'team',
    name: 'Team',
    icon: 'users',
    description: 'People with photo and role, kept as reusable entries.',
  },
  {
    id: 'contact',
    name: 'Contact form',
    icon: 'mail',
    description: 'A form whose messages are stored as entries.',
  },
  {
    id: 'call-to-action',
    name: 'Call to action',
    icon: 'megaphone',
    description: 'A short pitch with one button.',
  },
] as const;

export type SpaceBlockId = (typeof SPACE_BLOCKS)[number]['id'];

export const SPACE_BLOCK_IDS = SPACE_BLOCKS.map((entry) => entry.id) as [
  SpaceBlockId,
  ...SpaceBlockId[],
];

/** What the `custom` website type starts with when no blocks are named. */
export const DEFAULT_SPACE_BLOCKS: readonly SpaceBlockId[] = [
  'hero',
  'text',
  'media-text',
  'gallery',
  'quote',
  'call-to-action',
];

/**
 * Website types a new space can start as: a content model, published pages and a menu.
 * `blocks` are the catalog blocks it brings besides its own; `custom` brings the picked ones.
 */
export const SPACE_TEMPLATES = [
  {
    id: 'business',
    name: 'Company website',
    icon: 'building-2',
    description:
      'Services, a team, testimonials, questions and a contact form on pages built from sections.',
    blocks: [
      'hero',
      'text',
      'features',
      'stats',
      'testimonials',
      'team',
      'faq',
      'contact',
      'call-to-action',
    ],
  },
  {
    id: 'landing',
    name: 'Product or landing page',
    icon: 'rocket',
    description:
      'One strong page for a product, an app or an event: features, numbers, pricing and questions.',
    blocks: [
      'hero',
      'features',
      'media-text',
      'stats',
      'quote',
      'pricing',
      'faq',
      'call-to-action',
    ],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    icon: 'briefcase',
    description: 'Projects with client, year and gallery, shown in a project grid.',
    blocks: ['hero', 'text', 'media-text', 'gallery', 'quote', 'contact', 'call-to-action'],
  },
  {
    id: 'blog',
    name: 'Personal blog',
    icon: 'newspaper',
    description: 'Posts with a cover and a date, an about page and a blogroll.',
    blocks: [],
  },
  {
    id: 'basic',
    name: 'Basic setup',
    icon: 'layout-grid',
    description: 'Pages built from teaser blocks, a blog with one article and a main menu.',
    blocks: [],
  },
  {
    id: 'custom',
    name: 'Pick your blocks',
    icon: 'blocks',
    description: 'Choose the sections your pages are built from; the design adapts to them.',
    blocks: DEFAULT_SPACE_BLOCKS,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  icon: string;
  description: string;
  blocks: readonly SpaceBlockId[];
}>;

export type SpaceTemplateId = (typeof SPACE_TEMPLATES)[number]['id'];

export const SPACE_TEMPLATE_IDS = SPACE_TEMPLATES.map((entry) => entry.id) as [
  SpaceTemplateId,
  ...SpaceTemplateId[],
];
