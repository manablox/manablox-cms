import {
  ELEMENT_KINDS,
  type ElementKind,
  PALETTE_TYPE,
  paletteKindType,
  type SiteDesignKind,
} from '@manablox/site';

/** What the designer calls each element. */
export const ELEMENT_LABELS: Record<ElementKind, string> = {
  box: 'Box',
  stack: 'Stack',
  grid: 'Grid',
  section: 'Section',
  spacer: 'Spacer',
  divider: 'Divider',
  text: 'Text',
  heading: 'Heading',
  richtext: 'Rich text',
  image: 'Image',
  video: 'Video',
  icon: 'Icon',
  link: 'Link',
  button: 'Button',
  embed: 'Embed',
  repeat: 'Repeat',
  blocks: 'Blocks',
  block: 'Block',
  template: 'Template',
  form: 'Form',
  formField: 'Form field',
  formSubmit: 'Submit button',
  formMessage: 'Form message',
  slot: 'Page content',
  menu: 'Menu',
  logo: 'Logo',
  breadcrumbs: 'Breadcrumbs',
  localeSwitch: 'Language switch',
  searchLink: 'Search link',
};

/** A sentence per palette entry. */
export const ELEMENT_HINTS: Partial<Record<ElementKind, string>> = {
  box: 'A plain container',
  stack: 'Items in a row or a column',
  grid: 'Items in columns',
  section: 'A full-width band with a centred container',
  spacer: 'Empty space',
  divider: 'A horizontal line',
  text: 'A line or paragraph',
  heading: 'A title, h1 to h6',
  richtext: 'Formatted text from a field',
  image: 'A picture from a field or the assets',
  video: 'A video file',
  icon: 'A small symbol',
  link: 'A link around text or other elements',
  button: 'A call to action',
  embed: 'YouTube, Vimeo, maps and more',
  repeat: 'Shows its content once per entry of a list',
  blocks: 'The blocks of a blocks field',
  block: 'The block of a block field',
  template: 'The blocks of a template field',
  form: 'A form that stores what visitors send as a databag entry',
  formField: 'One input of the form',
  formSubmit: 'The button that sends the form',
  formMessage: 'The thank-you or error message after sending',
  slot: 'Where the page itself goes; a layout has exactly one',
  menu: 'One of the space menus',
  logo: 'The site logo, or its name',
  breadcrumbs: 'The path from the home page to this page',
  localeSwitch: 'Links to this page in the other languages',
  searchLink: 'A link to a search page',
};

/** An icon per element, in the palette and the outline. */
export const ELEMENT_ICONS: Record<ElementKind, string> = {
  box: 'square',
  stack: 'rows-3',
  grid: 'layout-grid',
  section: 'rectangle-horizontal',
  spacer: 'move-vertical',
  divider: 'minus',
  text: 'type',
  heading: 'heading-2',
  richtext: 'pilcrow',
  image: 'image',
  video: 'film',
  icon: 'star',
  link: 'link',
  button: 'mouse-pointer-click',
  embed: 'frame',
  repeat: 'repeat',
  blocks: 'blocks',
  block: 'component',
  template: 'template',
  form: 'clipboard-list',
  formField: 'text-cursor-input',
  formSubmit: 'send',
  formMessage: 'message-square',
  slot: 'doc',
  menu: 'menu',
  logo: 'flag',
  breadcrumbs: 'chevrons-right',
  localeSwitch: 'languages',
  searchLink: 'search',
};

const PALETTE_GROUPS: ReadonlyArray<{ label: string; hint: string; kinds: ElementKind[] }> = [
  {
    label: 'Content',
    hint: 'Text, pictures and buttons',
    kinds: ['heading', 'text', 'richtext', 'image', 'button', 'link', 'video', 'icon', 'embed'],
  },
  {
    label: 'Layout',
    hint: 'Arrange other elements',
    kinds: ['stack', 'grid', 'section', 'box', 'spacer', 'divider'],
  },
  {
    label: 'From your content',
    hint: 'Lists and nested blocks your editors fill in',
    kinds: ['repeat', 'blocks', 'block', 'template'],
  },
];

/** Design kinds a form can sit in, as the site accepts their posts. */
export const FORM_DESIGN_KINDS: readonly SiteDesignKind[] = ['block', 'page', 'layout'];

/** The palette of a designer: forms where the site takes their posts, chrome only in layouts. */
export function paletteGroups(designKind: SiteDesignKind) {
  const groups = PALETTE_GROUPS.map((group) => ({ ...group, kinds: [...group.kinds] }));
  if (FORM_DESIGN_KINDS.includes(designKind))
    groups.push({
      label: 'Form',
      hint: 'Let visitors send you a message',
      kinds: ['form', 'formField', 'formSubmit', 'formMessage'],
    });
  if (designKind === 'layout')
    groups.unshift({
      label: 'Site',
      hint: 'Header and footer parts',
      kinds: ['slot', 'menu', 'logo', 'breadcrumbs', 'localeSwitch', 'searchLink'],
    });
  return groups;
}

/** The element kind a palette drag carries, read from its types before the drop. */
export function paletteDragKind(types: readonly string[]): ElementKind | null {
  if (!types.includes(PALETTE_TYPE)) return null;
  return ELEMENT_KINDS.find((kind) => types.includes(paletteKindType(kind))) ?? null;
}

/** The node id of a ref into the given design, else `null`. */
export function nodeIdOf(
  ref: string | null | undefined,
  kind: SiteDesignKind,
  key: string,
): string | null {
  const parts = ref?.split(':');
  if (parts?.length !== 3 || parts[0] !== kind || parts[1] !== key || !parts[2]) return null;
  return parts[2];
}

/** Icons the site renderer draws. */
export const SITE_ICONS = [
  'arrow-right',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'chevron-right',
  'chevron-left',
  'chevron-down',
  'chevron-up',
  'external-link',
  'check',
  'close',
  'plus',
  'minus',
  'menu',
  'search',
  'mail',
  'phone',
  'map-pin',
  'calendar',
  'clock',
  'user',
  'users',
  'home',
  'globe',
  'star',
  'heart',
  'info',
  'alert',
  'download',
  'play',
  'quote',
  'link',
  'share',
] as const;
