import {
  IMAGE,
  paragraphs,
  SIDEBAR,
  type SpaceTemplate,
  summaryField,
  TEXTAREA,
} from './shared.js';

/** Posts, plain pages and a blogroll databag, for one writer. */
export const blogTemplate: SpaceTemplate = {
  types: [
    {
      name: 'post',
      label: 'Post',
      icon: 'newspaper',
      description: 'A dated blog post with a cover image.',
      fields: [
        {
          name: 'date',
          label: 'Date',
          type: 'date',
          settings: { mode: 'date', defaultNow: true },
          admin: SIDEBAR,
        },
        { name: 'cover', label: 'Cover image', type: 'asset', settings: IMAGE, admin: SIDEBAR },
        {
          name: 'featured',
          label: 'Featured',
          type: 'boolean',
          admin: { ...SIDEBAR, help: 'Shown first on the home page.' },
        },
        summaryField,
        { name: 'body', label: 'Body', type: 'richtext', localized: true },
      ],
    },
    {
      name: 'page',
      label: 'Page',
      icon: 'doc',
      description: 'A plain page of text, like About or Now.',
      fields: [summaryField, { name: 'body', label: 'Body', type: 'richtext', localized: true }],
    },
    {
      name: 'blogroll',
      label: 'Blogroll entry',
      kind: 'data',
      icon: 'link-2',
      description: 'A blog or site you recommend, for a list in the sidebar or footer.',
      fields: [
        { name: 'url', label: 'Address', type: 'string', required: true },
        { name: 'note', label: 'Note', type: 'string', localized: true, settings: TEXTAREA },
      ],
    },
  ],
  documents: [
    {
      key: 'home',
      type: 'page',
      title: 'Home',
      slug: 'home',
      position: 0,
      fields: ({ space }) => ({
        summary: `Welcome to ${space.name}.`,
        body: paragraphs(
          `Hi, and welcome to ${space.name}. This is where I write about the things I make, read and think about.`,
          'The latest posts are listed under Posts.',
        ),
      }),
    },
    {
      key: 'posts',
      type: 'page',
      title: 'Posts',
      slug: 'posts',
      position: 1,
      fields: () => ({
        summary: 'Everything I have written, newest first.',
        body: paragraphs('The posts below this page, newest first.'),
      }),
    },
    {
      key: 'hello-world',
      type: 'post',
      title: 'Hello, world',
      slug: 'hello-world',
      parent: 'posts',
      fields: () => ({
        featured: true,
        summary: 'The first post on this blog, and what comes next.',
        body: paragraphs(
          'Posts live under the Posts page, so their addresses start with posts/.',
          'Write a new one from Content, give it a cover image, or delete this one.',
        ),
      }),
    },
    {
      key: 'why-i-write',
      type: 'post',
      title: 'Why I write',
      slug: 'why-i-write',
      parent: 'posts',
      fields: () => ({
        featured: false,
        summary: 'Writing things down is the best way to understand them.',
        body: paragraphs(
          'A second sample post. Tags, found on every document, group posts by topic.',
        ),
      }),
    },
    {
      key: 'about',
      type: 'page',
      title: 'About',
      slug: 'about',
      position: 2,
      fields: () => ({
        summary: 'Who writes here.',
        body: paragraphs('Tell your readers who you are and what they can expect here.'),
      }),
    },
    {
      key: 'blogroll-example',
      type: 'blogroll',
      title: "A friend's blog",
      fields: () => ({
        url: 'https://example.com',
        note: 'Replace this with a blog you like to read.',
      }),
    },
  ],
  home: 'home',
  menu: ['home', 'posts', 'about'],
};
