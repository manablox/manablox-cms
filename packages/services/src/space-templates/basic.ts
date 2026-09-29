import { blockPage, blocksOf, IMAGE, paragraphs, type SpaceTemplate, TEXTAREA } from './shared.js';

/** `teaser`, `page` and `article`, as in the getting-started guide. */
export const basicTemplate: SpaceTemplate = {
  types: [
    {
      name: 'teaser',
      label: 'Teaser',
      kind: 'block',
      icon: 'panels-top-left',
      description: 'A headline, a short text and an image, for lists of highlights.',
      fields: [
        { name: 'headline', label: 'Headline', type: 'string', required: true },
        { name: 'body', label: 'Body', type: 'richtext' },
        { name: 'image', label: 'Image', type: 'asset', settings: IMAGE },
      ],
    },
    blockPage(['teaser']),
    {
      name: 'article',
      label: 'Article',
      icon: 'newspaper',
      description: 'A dated piece of writing: a news item or a blog post.',
      fields: [
        {
          name: 'date',
          label: 'Date',
          type: 'date',
          settings: { mode: 'date', defaultNow: true },
          admin: { zone: 'sidebar' },
        },
        {
          name: 'image',
          label: 'Image',
          type: 'asset',
          settings: IMAGE,
          admin: { zone: 'sidebar' },
        },
        { name: 'summary', label: 'Summary', type: 'string', localized: true, settings: TEXTAREA },
        { name: 'body', label: 'Body', type: 'richtext', localized: true },
      ],
    },
  ],
  documents: [
    {
      key: 'home',
      type: 'page',
      title: 'Home',
      slug: 'home',
      // A two-column grid shows off the grid board; the other pages are lists.
      fields: ({ space, block }) => ({
        summary: `Welcome to ${space.name}.`,
        components: blocksOf(
          [
            block(
              'teaser',
              {
                headline: `Welcome to ${space.name}`,
                body: paragraphs(
                  'This page was created with the basic setup. Edit it, add blocks, or delete it and start over.',
                ),
              },
              { column: 1, row: 1 },
            ),
            block(
              'teaser',
              {
                headline: 'Build your content model',
                body: paragraphs(
                  'The Page and Article types under Content types are a starting point. Add fields, or new types, as the site grows.',
                ),
              },
              { column: 2, row: 1 },
            ),
          ],
          { desktop: { columns: 2 }, tablet: { columns: 2 }, mobile: { columns: 1 } },
        ),
      }),
    },
    {
      key: 'about',
      type: 'page',
      title: 'About',
      slug: 'about',
      fields: ({ space, block }) => ({
        summary: `What ${space.name} is about.`,
        components: blocksOf([
          block('teaser', {
            headline: 'About us',
            body: paragraphs('Tell your visitors who you are and what this site is for.'),
          }),
        ]),
      }),
    },
    {
      key: 'blog',
      type: 'page',
      title: 'Blog',
      slug: 'blog',
      fields: () => ({ summary: 'News and articles.', components: blocksOf([]) }),
    },
    {
      key: 'hello-world',
      type: 'article',
      title: 'Hello world',
      slug: 'hello-world',
      parent: 'blog',
      fields: () => ({
        summary: 'The first article in this space.',
        body: paragraphs(
          'Articles live under the Blog page, so their permalinks start with blog/. Write a new one from Content, or delete this one.',
        ),
      }),
    },
  ],
  home: 'home',
  menu: ['home', 'about', 'blog'],
};
