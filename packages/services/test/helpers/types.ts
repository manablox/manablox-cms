import { type ContentTypeInput, defineContentType } from '@manablox/core';

// Block types first: content types reference them by id.
const teaser = defineContentType({
  name: 'teaser',
  kind: 'block',
  fields: [
    { name: 'headline', type: 'string' },
    { name: 'image', type: 'asset' },
  ],
});

/** A `teaser` block and an `article` that uses it, directly and inside repeater items. */
export const TEST_TYPES: ContentTypeInput[] = [
  { name: 'teaser', kind: 'block', fields: teaser.fields },
  {
    name: 'article',
    fields: [
      { name: 'body', type: 'richtext' },
      { name: 'hero', type: 'asset' },
      { name: 'author', type: 'user' },
      { name: 'related', type: 'content', settings: { multiple: false, types: [] } },
      { name: 'components', type: 'blocks', settings: { types: [teaser.id] } },
      { name: 'secret', type: 'string', readRoles: ['admin'], writeRoles: ['admin'] },
      {
        name: 'quotes',
        type: 'repeater',
        settings: {
          fields: [
            { name: 'quote', type: 'string', required: true },
            { name: 'photo', type: 'asset' },
            { name: 'teaser', type: 'block', settings: { type: teaser.id } },
          ],
        },
      },
    ],
  },
];
