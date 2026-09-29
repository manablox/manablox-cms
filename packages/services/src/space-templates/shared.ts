import type {
  BlockGridValue,
  BlockLayout,
  BlocksValue,
  BlockValue,
  ContentTypeInput,
} from '@manablox/core';
import type { SpaceRow } from '@manablox/db';

/** What a document's fields can point at while the template is written. */
export interface TemplateRefs {
  space: SpaceRow;
  /** The id of a document created earlier in the list. */
  doc(key: string): string;
  /** Whether a document of that key was created earlier. */
  hasDoc(key: string): boolean;
  /** The id of a template type. */
  type(name: string): string;
  /** A block of a template block type. */
  block(type: string, fields: Record<string, unknown>, layout?: BlockLayout): BlockValue;
}

export interface TemplateDocument {
  key: string;
  /** A template type's name. */
  type: string;
  title: string;
  /** Unset for databag entries. */
  slug?: string;
  /** Key of a document created earlier. */
  parent?: string;
  /** Defaults to the order among its siblings in the list. */
  position?: number;
  fields: (refs: TemplateRefs) => Record<string, unknown>;
}

/**
 * A space template. Types are created in order, so a field's `settings.types` may name any
 * type before it; documents are created in order, published, and may point at earlier ones.
 */
export interface SpaceTemplate {
  types: ContentTypeInput[];
  documents: TemplateDocument[];
  /** The key of the space's root document. */
  home: string;
  /** Keys of the main menu's items. */
  menu: string[];
}

/** A Tiptap document, one paragraph per text. */
export function paragraphs(...texts: string[]) {
  return {
    type: 'doc',
    content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

export function blocksOf(blocks: BlockValue[], grid?: BlockGridValue): BlocksValue {
  return grid ? { grid, blocks } : { blocks };
}

export const IMAGE = { accept: ['image/'] };
export const TEXTAREA = { editor: 'textarea' };
export const SIDEBAR = { zone: 'sidebar' } as const;

/** A localized one or two sentence summary, for listings and search results. */
export const summaryField = {
  name: 'summary',
  label: 'Summary',
  type: 'string',
  localized: true,
  settings: TEXTAREA,
  admin: { help: 'A sentence for listings and search results.' },
};

/** A page built from the given block types. */
export function blockPage(blockTypes: string[]): ContentTypeInput {
  return {
    name: 'page',
    label: 'Page',
    icon: 'doc',
    description: 'A page of the site, built from blocks.',
    fields: [
      summaryField,
      {
        name: 'components',
        label: 'Components',
        type: 'blocks',
        localized: true,
        settings: { types: blockTypes },
      },
    ],
  };
}

/** An internal link to a document. */
export function linkTo(contentId: string, label: string) {
  return { mode: 'internal', contentId, url: null, target: '_self', label };
}
