/** Field settings per field type, rendered by `FieldSettings`. */

/** One type-specific setting control. */
export interface SettingSpec {
  key: string;
  label: string;
  kind:
    | 'text'
    | 'number'
    | 'boolean'
    | 'select'
    | 'types'
    | 'templates'
    | 'options'
    | 'mimeTypes'
    | 'document'
    | 'presets'
    | 'sizes'
    | 'toolbar';
  group: 'rules' | 'value';
  /** Shown only when this returns true. */
  when?: (settings: Record<string, unknown>) => boolean;
  choices?: { value: string; label: string; hint?: string }[];
  hint?: string;
  /** The server schema's default, shown for unsaved settings. */
  default?: unknown;
  /** Full row width. */
  wide?: boolean;
}

const choices = (...items: [string, string, string?][]) =>
  items.map(([value, label, hint]) => ({ value, label, ...(hint ? { hint } : {}) }));

/** A relation resolved by query rather than picked; only with `multiple`. */
function isFilterSelection(settings: Record<string, unknown>): boolean {
  return settings.multiple === true && settings.selection === 'filter';
}

/** Rendition settings apply only to image-only fields. */
function isImageOnly(settings: Record<string, unknown>): boolean {
  const accept = settings.accept;
  return (
    Array.isArray(accept) &&
    accept.length > 0 &&
    accept.every((entry) => typeof entry === 'string' && entry.startsWith('image/'))
  );
}

const selectionSpecs = (label: string): SettingSpec[] => [
  {
    key: 'selection',
    label,
    kind: 'select',
    group: 'value',
    default: 'pick',
    wide: true,
    when: (settings) => settings.multiple === true,
    choices: choices(['pick', 'The ones an editor picks'], ['filter', 'Whatever matches a filter']),
    hint: 'A filter stores nothing on the document: delivery resolves it on every read.',
  },
  {
    key: 'search',
    label: 'Matching this text',
    kind: 'text',
    group: 'value',
    wide: true,
    when: isFilterSelection,
    hint: 'Leave empty to match everything the other settings allow.',
  },
];

const paginationSpecs: SettingSpec[] = [
  {
    key: 'limit',
    label: 'How many',
    kind: 'number',
    group: 'value',
    default: 10,
    when: isFilterSelection,
    hint: 'The page size, up to 100.',
  },
  {
    key: 'offset',
    label: 'Skipping the first',
    kind: 'number',
    group: 'value',
    default: 0,
    when: isFilterSelection,
    hint: 'For a field that is the second page of the same query.',
  },
];

/** Per-type controls. `rules`: what a value must satisfy; `value`: what it is and how it is entered. */
const SPECS: Record<string, SettingSpec[]> = {
  string: [
    {
      key: 'editor',
      label: 'Input',
      kind: 'select',
      group: 'value',
      choices: choices(['input', 'Single line'], ['textarea', 'Multi-line'], ['code', 'Code']),
    },
    { key: 'default', label: 'Default value', kind: 'text', group: 'value' },
    { key: 'min', label: 'Min length', kind: 'number', group: 'rules' },
    { key: 'max', label: 'Max length', kind: 'number', group: 'rules' },
    {
      key: 'pattern',
      label: 'Must match (regex)',
      kind: 'text',
      group: 'rules',
      wide: true,
      hint: 'A regular expression the whole value has to match, e.g. ^[A-Z]{3}-\\d+$',
    },
  ],
  number: [
    { key: 'default', label: 'Default value', kind: 'number', group: 'value' },
    { key: 'integer', label: 'Whole numbers only', kind: 'boolean', group: 'rules', wide: true },
    { key: 'min', label: 'Minimum', kind: 'number', group: 'rules' },
    { key: 'max', label: 'Maximum', kind: 'number', group: 'rules' },
  ],
  boolean: [
    { key: 'default', label: 'On by default', kind: 'boolean', group: 'value', wide: true },
  ],
  date: [
    {
      key: 'mode',
      label: 'Precision',
      kind: 'select',
      group: 'value',
      choices: choices(['date', 'Date only'], ['datetime', 'Date and time']),
    },
    { key: 'defaultNow', label: 'Default to now', kind: 'boolean', group: 'value' },
  ],
  select: [
    {
      key: 'options',
      label: 'Options',
      kind: 'options',
      group: 'value',
      wide: true,
      hint: 'One option per line, in the order they are offered.',
    },
    { key: 'multiple', label: 'Allow several', kind: 'boolean', group: 'rules', wide: true },
  ],
  richtext: [
    {
      key: 'toolbar',
      label: 'Editing tools',
      kind: 'toolbar',
      group: 'value',
      wide: true,
      hint: 'What the editor offers, in the panel and in place in the visual editor.',
    },
  ],
  link: [
    {
      key: 'allowInternal',
      label: 'A document in this space',
      kind: 'boolean',
      group: 'rules',
      default: true,
    },
    {
      key: 'allowExternal',
      label: 'An address elsewhere',
      kind: 'boolean',
      group: 'rules',
      default: true,
    },
    {
      key: 'types',
      label: 'Can link to',
      kind: 'types',
      group: 'rules',
      wide: true,
      hint: 'Leave empty to allow any type. Only applies to a document link.',
    },
    {
      key: 'allowTarget',
      label: 'Let the editor choose the tab',
      kind: 'boolean',
      group: 'value',
      default: true,
    },
    {
      key: 'defaultTarget',
      label: 'Opens in',
      kind: 'select',
      group: 'value',
      default: '_self',
      choices: choices(['_self', 'The same tab'], ['_blank', 'A new tab']),
    },
    {
      key: 'allowLabel',
      label: 'Let the editor write the link text',
      kind: 'boolean',
      group: 'value',
      default: true,
      wide: true,
    },
  ],
  asset: [
    {
      key: 'accept',
      label: 'Accepted file types',
      kind: 'mimeTypes',
      group: 'rules',
      wide: true,
      hint: 'Leave empty to accept everything the space allows.',
    },
    { key: 'multiple', label: 'Allow several', kind: 'boolean', group: 'rules', wide: true },
    {
      key: 'presets',
      label: 'Renditions delivered',
      kind: 'presets',
      group: 'value',
      wide: true,
      when: isImageOnly,
      hint: 'Leave empty to deliver every rendition the instance configures.',
    },
    {
      key: 'sizes',
      label: 'Sizes of its own',
      kind: 'sizes',
      group: 'value',
      wide: true,
      when: isImageOnly,
    },
    ...selectionSpecs('Which files'),
    ...paginationSpecs,
  ],
  content: [
    { key: 'types', label: 'Can link to', kind: 'types', group: 'rules', wide: true },
    { key: 'multiple', label: 'Allow several', kind: 'boolean', group: 'rules', wide: true },
    ...selectionSpecs('Which documents'),
    {
      key: 'under',
      label: 'Only below this document',
      kind: 'document',
      group: 'value',
      wide: true,
      when: isFilterSelection,
      hint: 'Leave empty to search the whole space.',
    },
    {
      key: 'sortBy',
      label: 'Ordered by',
      kind: 'select',
      group: 'value',
      default: 'position',
      when: isFilterSelection,
      choices: choices(
        ['position', 'Their place in the tree'],
        ['title', 'Title'],
        ['publishedAt', 'When they went live'],
        ['createdAt', 'When they were created'],
        ['updatedAt', 'When they were last edited'],
        ['slug', 'Slug'],
      ),
    },
    {
      key: 'sortDirection',
      label: 'Direction',
      kind: 'select',
      group: 'value',
      default: 'asc',
      when: isFilterSelection,
      choices: choices(['asc', 'First to last'], ['desc', 'Last to first']),
    },
    ...paginationSpecs,
  ],
  user: [{ key: 'multiple', label: 'Allow several', kind: 'boolean', group: 'rules', wide: true }],
  block: [{ key: 'type', label: 'Block type', kind: 'types', group: 'value', wide: true }],
  blocks: [
    { key: 'types', label: 'Allowed block types', kind: 'types', group: 'value', wide: true },
    { key: 'min', label: 'At least', kind: 'number', group: 'rules' },
    { key: 'max', label: 'At most', kind: 'number', group: 'rules' },
  ],
  repeater: [
    {
      key: 'min',
      label: 'At least',
      kind: 'number',
      group: 'rules',
      hint: 'Items an editor has to add.',
    },
    { key: 'max', label: 'At most', kind: 'number', group: 'rules' },
  ],
  databag: [
    {
      key: 'types',
      label: 'Offer these databag types',
      kind: 'types',
      group: 'value',
      wide: true,
      hint: 'Leave empty to offer every databag type in the space.',
    },
  ],
  template: [
    {
      key: 'templates',
      label: 'Offer these templates',
      kind: 'templates',
      group: 'value',
      wide: true,
      hint: 'Leave empty to offer every template in the space.',
    },
  ],
};

/** The settings shown for a field of `type` with these settings. */
export function specsFor(type: string, settings: Record<string, unknown>): SettingSpec[] {
  return (SPECS[type] ?? []).filter((spec) => !spec.when || spec.when(settings));
}

/** The rule flags every field has. */
export const FLAGS: { key: 'required' | 'localized' | 'unique'; label: string; hint: string }[] = [
  { key: 'required', label: 'Required', hint: 'A document cannot be saved while it is empty.' },
  { key: 'localized', label: 'Translated', hint: 'A separate value per language.' },
  {
    key: 'unique',
    label: 'Unique',
    hint: 'No two documents of this type may hold the same value. Applies to text, number, date and single select or reference fields.',
  },
];

export const ZONES = [
  { value: 'main', label: 'Main column', hint: 'With the title and the body' },
  { value: 'sidebar', label: 'Sidebar', hint: 'Beside it, for metadata' },
];
export const WIDTHS = [25, 50, 75, 100];
