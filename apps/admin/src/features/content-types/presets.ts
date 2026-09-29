import type { FieldDefinition } from '@manablox/admin-sdk/features/content-types/queries';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import type { TypeKind } from './model';

type PresetField = Pick<FieldDefinition, 'name' | 'label' | 'type'> &
  Partial<Pick<FieldDefinition, 'settings' | 'required' | 'localized'>> & {
    zone?: 'main' | 'sidebar';
  };

/** A ready-made starting point for a new type; `id` is also its technical name. */
export interface TypePreset {
  id: string;
  kind: TypeKind;
  label: string;
  icon: string;
  description: string;
  fields: PresetField[];
  /** Unset means publishable. */
  isPublishable?: boolean;
}

const IMAGE = { accept: ['image/'] };
const TEXTAREA = { editor: 'textarea' };

export const TYPE_PRESETS: readonly TypePreset[] = [
  {
    id: 'hero',
    kind: 'block',
    label: 'Hero',
    icon: 'panels-top-left',
    description: 'The big opener at the top of a page.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string', required: true },
      { name: 'subline', label: 'Subline', type: 'string' },
      { name: 'content', label: 'Content', type: 'richtext' },
      { name: 'background-image', label: 'Background image', type: 'asset', settings: IMAGE },
      { name: 'hero-image', label: 'Hero image', type: 'asset', settings: IMAGE },
    ],
  },
  {
    id: 'content',
    kind: 'block',
    label: 'Content',
    icon: 'notebook-text',
    description: 'A text section with an optional button.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string', required: true },
      { name: 'subline', label: 'Subline', type: 'string' },
      { name: 'content', label: 'Content', type: 'richtext' },
      { name: 'button', label: 'Button', type: 'link' },
    ],
  },
  {
    id: 'image',
    kind: 'block',
    label: 'Image',
    icon: 'image',
    description: 'A single picture with a caption.',
    fields: [
      { name: 'image', label: 'Image', type: 'asset', settings: IMAGE, required: true },
      { name: 'caption', label: 'Caption', type: 'string' },
    ],
  },
  {
    id: 'gallery',
    kind: 'block',
    label: 'Gallery',
    icon: 'images',
    description: 'Several pictures under a headline.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string' },
      {
        name: 'images',
        label: 'Images',
        type: 'asset',
        settings: { ...IMAGE, multiple: true },
        required: true,
      },
    ],
  },
  {
    id: 'quote',
    kind: 'block',
    label: 'Quote',
    icon: 'message-square',
    description: 'A testimonial or a highlighted statement.',
    fields: [
      { name: 'quote', label: 'Quote', type: 'string', settings: TEXTAREA, required: true },
      { name: 'author', label: 'Author', type: 'string' },
      { name: 'role', label: 'Role', type: 'string' },
    ],
  },
  {
    id: 'call-to-action',
    kind: 'block',
    label: 'Call to action',
    icon: 'megaphone',
    description: 'A short pitch with one button.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string', required: true },
      { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
      { name: 'button', label: 'Button', type: 'link', required: true },
    ],
  },
  {
    id: 'form',
    kind: 'block',
    label: 'Form',
    icon: 'clipboard-list',
    description: 'A form for visitors; editors pick the databag type it stores in.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string' },
      { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
      { name: 'databag', label: 'Databag', type: 'databag', required: true },
    ],
  },
  {
    id: 'page',
    kind: 'content',
    label: 'Page',
    icon: 'doc',
    description: 'A page of the site, built from blocks.',
    fields: [
      { name: 'summary', label: 'Summary', type: 'string', settings: TEXTAREA, localized: true },
      { name: 'components', label: 'Components', type: 'blocks', localized: true },
    ],
  },
  {
    id: 'article',
    kind: 'content',
    label: 'Article',
    icon: 'newspaper',
    description: 'A dated piece of writing: a news item or a blog post.',
    fields: [
      {
        name: 'date',
        label: 'Date',
        type: 'date',
        settings: { mode: 'date', defaultNow: true },
        zone: 'sidebar',
      },
      { name: 'image', label: 'Image', type: 'asset', settings: IMAGE, zone: 'sidebar' },
      { name: 'summary', label: 'Summary', type: 'string', settings: TEXTAREA, localized: true },
      { name: 'body', label: 'Body', type: 'richtext', localized: true },
    ],
  },
  {
    id: 'event',
    kind: 'content',
    label: 'Event',
    icon: 'calendar-days',
    description: 'Something that happens at a time and place.',
    fields: [
      { name: 'starts', label: 'Starts', type: 'date', required: true, zone: 'sidebar' },
      { name: 'ends', label: 'Ends', type: 'date', zone: 'sidebar' },
      { name: 'location', label: 'Location', type: 'string', localized: true, zone: 'sidebar' },
      { name: 'image', label: 'Image', type: 'asset', settings: IMAGE, zone: 'sidebar' },
      { name: 'summary', label: 'Summary', type: 'string', settings: TEXTAREA, localized: true },
      { name: 'body', label: 'Body', type: 'richtext', localized: true },
    ],
  },
  {
    id: 'contact-submission',
    kind: 'data',
    label: 'Contact submission',
    icon: 'mail',
    description: 'What a contact form sends; kept in the admin, never delivered.',
    isPublishable: false,
    fields: [
      { name: 'name', label: 'Name', type: 'string', required: true },
      { name: 'email', label: 'Email', type: 'string', required: true },
      { name: 'phone', label: 'Phone', type: 'string' },
      { name: 'message', label: 'Message', type: 'string', settings: TEXTAREA, required: true },
      { name: 'consent', label: 'Consent', type: 'boolean' },
    ],
  },
  {
    id: 'newsletter-subscriber',
    kind: 'data',
    label: 'Newsletter subscriber',
    icon: 'send',
    description: 'A sign-up from a newsletter form; kept in the admin, never delivered.',
    isPublishable: false,
    fields: [
      { name: 'email', label: 'Email', type: 'string', required: true },
      { name: 'name', label: 'Name', type: 'string' },
      { name: 'confirmed', label: 'Confirmed', type: 'boolean' },
    ],
  },
  {
    id: 'faq',
    kind: 'data',
    label: 'FAQ',
    icon: 'circle-help',
    description: 'A question and its answer, for a FAQ list on the site.',
    fields: [
      { name: 'question', label: 'Question', type: 'string', required: true, localized: true },
      { name: 'answer', label: 'Answer', type: 'richtext', required: true, localized: true },
    ],
  },
  {
    id: 'testimonial',
    kind: 'data',
    label: 'Testimonial',
    icon: 'message-circle',
    description: 'A customer quote, for reuse across pages.',
    fields: [
      {
        name: 'quote',
        label: 'Quote',
        type: 'string',
        settings: TEXTAREA,
        required: true,
        localized: true,
      },
      { name: 'author', label: 'Author', type: 'string', required: true },
      { name: 'role', label: 'Role', type: 'string', localized: true },
      { name: 'photo', label: 'Photo', type: 'asset', settings: IMAGE },
    ],
  },
  {
    id: 'location',
    kind: 'data',
    label: 'Location',
    icon: 'map-pin',
    description: 'A shop, office or venue with its address.',
    fields: [
      { name: 'address', label: 'Address', type: 'string', settings: TEXTAREA, required: true },
      { name: 'phone', label: 'Phone', type: 'string' },
      { name: 'email', label: 'Email', type: 'string' },
      {
        name: 'opening-hours',
        label: 'Opening hours',
        type: 'string',
        settings: TEXTAREA,
        localized: true,
      },
      { name: 'image', label: 'Image', type: 'asset', settings: IMAGE },
    ],
  },
];

/** The kind's presets, leaving out those whose name a type already has. */
export function presetsFor(
  kind: TypeKind,
  taken: ReadonlySet<string> = new Set(),
  extra: readonly TypePreset[] = [],
): TypePreset[] {
  return [...TYPE_PRESETS, ...extra].filter(
    (preset) => preset.kind === kind && !taken.has(preset.id),
  );
}

/** The preset's fields as new field definitions, each with a fresh id. */
export function presetFields(preset: TypePreset): FieldDefinition[] {
  return preset.fields.map(({ zone, settings, ...field }, position) => ({
    id: crypto.randomUUID(),
    required: false,
    localized: false,
    unique: false,
    ...field,
    settings: plainClone(settings ?? {}),
    admin: { zone: zone ?? 'main', width: 100, position },
  }));
}
