import type { ElementKind, SiteDesignKind } from './types.js';

export type ElementCategory = 'structure' | 'content' | 'data' | 'form' | 'chrome';

export interface ElementInfo {
  category: ElementCategory;
  /** Whether the element takes children. */
  container: boolean;
  /** Content comes from `bind`; the element is useless without one. */
  requiresBind?: boolean;
  /** Props holding `LocalizedText`. */
  textProps?: readonly string[];
  /** Rendered by an island script on the client. */
  island?: boolean;
}

export const ELEMENTS: Record<ElementKind, ElementInfo> = {
  box: { category: 'structure', container: true },
  stack: { category: 'structure', container: true },
  grid: { category: 'structure', container: true },
  section: { category: 'structure', container: true },
  spacer: { category: 'structure', container: false },
  divider: { category: 'structure', container: false },

  text: { category: 'content', container: false, textProps: ['text'] },
  heading: { category: 'content', container: false, textProps: ['text'] },
  richtext: { category: 'content', container: false },
  image: { category: 'content', container: false, textProps: ['alt'] },
  video: { category: 'content', container: false },
  icon: { category: 'content', container: false, textProps: ['label'] },
  link: { category: 'content', container: true, textProps: ['text'] },
  button: { category: 'content', container: false, textProps: ['text'] },
  embed: { category: 'content', container: false, textProps: ['title'] },

  repeat: { category: 'data', container: true, requiresBind: true },
  blocks: { category: 'data', container: false, requiresBind: true },
  block: { category: 'data', container: false, requiresBind: true },
  template: { category: 'data', container: false, requiresBind: true },

  form: {
    category: 'form',
    container: true,
    textProps: ['successMessage', 'consentText'],
    island: true,
  },
  formField: { category: 'form', container: false, textProps: ['label', 'placeholder', 'help'] },
  formSubmit: { category: 'form', container: false, textProps: ['text'] },
  formMessage: { category: 'form', container: false, textProps: ['text'] },

  slot: { category: 'chrome', container: false },
  menu: { category: 'chrome', container: false, island: true },
  logo: { category: 'chrome', container: false },
  breadcrumbs: { category: 'chrome', container: false, textProps: ['label'] },
  localeSwitch: { category: 'chrome', container: false, textProps: ['label'], island: true },
  searchLink: { category: 'chrome', container: false, textProps: ['text'] },
};

export const ELEMENT_KINDS = Object.keys(ELEMENTS) as ElementKind[];

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === 'string' && Object.hasOwn(ELEMENTS, value);
}

/** Embed providers the renderer knows how to frame. */
export const EMBED_PROVIDERS = ['youtube', 'vimeo', 'googleMaps', 'spotify', 'soundcloud'] as const;

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost'] as const;

/** Where an element may be placed: chrome only in layouts, form parts only inside a form. */
export function canPlace(
  el: ElementKind,
  designKind: SiteDesignKind,
  ancestors: readonly ElementKind[],
): boolean {
  const info = ELEMENTS[el];
  if (info.category === 'chrome' && designKind !== 'layout') return false;
  // A link wrapping another link, a button or a form is invalid HTML.
  if (ancestors.includes('link') && (el === 'link' || el === 'button' || el === 'form'))
    return false;
  const inForm = ancestors.includes('form');
  if (el === 'form') return !inForm;
  if (el === 'formField' || el === 'formSubmit' || el === 'formMessage') return inForm;
  return true;
}

/** Whether `child` may go directly into `parent`. */
export function canContain(parent: ElementKind, child: ElementKind): boolean {
  if (!ELEMENTS[parent].container) return false;
  return !(parent === 'link' && (child === 'link' || child === 'button' || child === 'form'));
}
