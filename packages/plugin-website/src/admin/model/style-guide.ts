import type { ContentTypeDefinition } from '@manablox/core';
import { defaultSiteSettings, type SiteRenderInput, type ThemeDesign } from '@manablox/site';
import { FORM_TYPE_ID, PROSE_FIELD_ID, styleGuidePage } from './style-guide-page';

/** The synthetic content type the style guide page renders as. */
const GUIDE_TYPE_ID = 'style-guide';

const FORM_FIELDS = [
  { id: 'name', label: 'Name', type: 'string', required: true, settings: {} },
  { id: 'email', label: 'Email', type: 'string', required: true, settings: {} },
  {
    id: 'topic',
    label: 'Topic',
    type: 'select',
    required: false,
    settings: {
      options: [
        { value: 'question', label: 'A question' },
        { value: 'project', label: 'A new project' },
      ],
    },
  },
  {
    id: 'message',
    label: 'Message',
    type: 'string',
    required: true,
    settings: { editor: 'textarea' },
  },
  {
    id: 'newsletter',
    label: 'Send me the newsletter',
    type: 'boolean',
    required: false,
    settings: {},
  },
];

const PROSE = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Rich text uses the prose styles: ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: '#' } }] },
        { type: 'text', text: ' inside a paragraph.' },
      ],
    },
    {
      type: 'bulletList',
      content: ['First item', 'Second item'].map((text) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quotation set apart.' }] }],
    },
  ],
};

/** The databag type behind the sample form. */
function formType(spaceId: string): ContentTypeDefinition {
  return {
    id: FORM_TYPE_ID,
    name: 'styleGuideForm',
    label: 'Sample form',
    kind: 'data',
    spaceId,
    hasSlug: false,
    isPublishable: false,
    isVisibleInTree: false,
    canBeVisibleInMenu: false,
    requiresApproval: false,
    isSystem: false,
    source: 'runtime',
    fields: FORM_FIELDS.map((field, position) => ({
      ...field,
      name: field.id,
      localized: false,
      unique: false,
      admin: { position, zone: 'main' as const, width: 100 },
    })),
  } satisfies ContentTypeDefinition;
}

/** A synthetic page render of the style guide, for the canvas. */
export function styleGuideInput(
  theme: ThemeDesign,
  space: { id: string; name: string; defaultLocale: string; locales: string[] },
): SiteRenderInput {
  const locale = space.defaultLocale;
  const type = {
    id: GUIDE_TYPE_ID,
    name: 'styleGuide',
    label: 'Style guide',
    kind: 'content',
    spaceId: space.id,
    hasSlug: false,
    isPublishable: false,
    isVisibleInTree: false,
    canBeVisibleInMenu: false,
    requiresApproval: false,
    isSystem: false,
    source: 'runtime',
    fields: [
      {
        id: PROSE_FIELD_ID,
        name: PROSE_FIELD_ID,
        label: 'Prose',
        type: 'richtext',
        required: false,
        localized: false,
        unique: false,
        settings: {},
        admin: { position: 0, zone: 'main', width: 100 },
      },
    ],
  } satisfies ContentTypeDefinition;
  return {
    mode: 'canvas',
    space,
    locale,
    url: '/',
    alternates: [],
    document: {
      id: GUIDE_TYPE_ID,
      localizationId: GUIDE_TYPE_ID,
      typeId: GUIDE_TYPE_ID,
      title: 'Style guide',
      permalink: '/',
      publishedAt: null,
      fields: { [PROSE_FIELD_ID]: PROSE },
    },
    status: 200,
    contentTypes: { [GUIDE_TYPE_ID]: type, [FORM_TYPE_ID]: formType(space.id) },
    page: { key: GUIDE_TYPE_ID, design: styleGuidePage(theme, locale) },
    layout: {
      key: 'default',
      design: { root: { id: 'root', el: 'box', children: [{ id: 'slot', el: 'slot' }] } },
    },
    blockDesigns: {},
    menuDesigns: {},
    menus: {},
    theme,
    site: { ...defaultSiteSettings(), name: space.name },
    assets: {},
    cssHref: '',
    formActionBase: '',
  };
}
