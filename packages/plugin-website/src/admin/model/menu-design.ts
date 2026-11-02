import {
  defaultMenuDesign,
  type MenuDesign,
  type MenuLevelStyle,
  type MenuMobile,
  type MenuPreset,
  type StyleRules,
} from '@manablox/site';

/** Presets with a name and a sentence. */
export const MENU_PRESETS: ReadonlyArray<{ value: MenuPreset; label: string; hint: string }> = [
  { value: 'bar', label: 'Horizontal bar', hint: 'Top-level entries in a row, nothing below them' },
  { value: 'list', label: 'Vertical list', hint: 'Entries under each other, sub-entries indented' },
  {
    value: 'dropdown',
    label: 'Dropdown',
    hint: 'A row whose sub-entries open below on hover or focus',
  },
  { value: 'mega', label: 'Mega menu', hint: 'A row whose sub-entries open as a wide panel' },
  {
    value: 'columns',
    label: 'Footer columns',
    hint: 'Each top-level entry heads a column of its sub-entries',
  },
];

export const MOBILE_BEHAVIOURS: ReadonlyArray<{
  value: MenuMobile['behaviour'];
  label: string;
  hint: string;
}> = [
  { value: 'none', label: 'Keep as is', hint: 'Small screens show the same menu' },
  { value: 'burger', label: 'Burger button', hint: 'A button opens the menu below it' },
  {
    value: 'offcanvas',
    label: 'Slide-in panel',
    hint: 'A button slides the menu in from the side',
  },
];

export const MOBILE_BREAKPOINTS: ReadonlyArray<{ value: MenuMobile['breakpoint']; label: string }> =
  [
    { value: 'tablet', label: 'Tablets and phones (below 1024px)' },
    { value: 'mobile', label: 'Phones only (below 640px)' },
  ];

/** The parts of a menu level the designer styles. */
export type MenuLevelPart = 'list' | 'item' | 'link' | 'current';

export const LEVEL_PARTS: ReadonlyArray<{
  value: MenuLevelPart;
  label: string;
  hint: string;
  states: boolean;
}> = [
  {
    value: 'link',
    label: 'Links',
    hint: 'Each entry, with hover, focus and pressed states',
    states: true,
  },
  {
    value: 'current',
    label: 'Current page',
    hint: 'The link of the page being shown and its parents',
    states: false,
  },
  {
    value: 'item',
    label: 'Entries',
    hint: 'The box around each entry and its sub-entries',
    states: true,
  },
  { value: 'list', label: 'List', hint: 'The whole level, e.g. the dropdown panel', states: false },
];

/** Levels deep a preset can show. */
export function maxDepth(preset: MenuPreset): number {
  return preset === 'bar' ? 1 : preset === 'columns' ? 2 : 3;
}

/** A complete starting design for a preset. */
export function presetDesign(preset: MenuPreset): MenuDesign {
  if (preset === 'columns') return defaultMenuDesign('footer');
  const main = defaultMenuDesign('main');
  if (preset === 'list') {
    return {
      preset,
      depth: 2,
      levels: [
        {
          list: { base: { gap: 'space:2' } },
          link: {
            base: { color: 'color:text', textDecoration: 'none' },
            hover: { color: 'color:primary' },
          },
          current: { color: 'color:primary', fontWeight: 600 },
        },
        {
          link: {
            base: { color: 'color:muted', textDecoration: 'none' },
            hover: { color: 'color:text' },
          },
        },
      ],
      mobile: { behaviour: 'none', breakpoint: 'mobile' },
    };
  }
  return { ...main, preset, depth: Math.min(main.depth, maxDepth(preset)) };
}

/** Switches the preset, keeping the styles; the depth shrinks to what the preset shows. */
export function withPreset(design: MenuDesign, preset: MenuPreset): MenuDesign {
  return { ...design, preset, depth: Math.min(Math.max(design.depth, 1), maxDepth(preset)) };
}

export function withDepth(design: MenuDesign, depth: number): MenuDesign {
  return { ...design, depth: Math.min(Math.max(Math.round(depth), 1), maxDepth(design.preset)) };
}

/** A level part's styles as `StyleRules`; the current page's props sit in `base`. */
export function levelRules(
  design: MenuDesign,
  level: number,
  part: MenuLevelPart,
): StyleRules | undefined {
  const entry = design.levels[level];
  if (!entry) return undefined;
  if (part === 'current') return entry.current ? { base: entry.current } : undefined;
  return entry[part];
}

/** The design with one level part's styles replaced; empty levels at the end are dropped. */
export function withLevelRules(
  design: MenuDesign,
  level: number,
  part: MenuLevelPart,
  rules: StyleRules | undefined,
): MenuDesign {
  const levels: MenuLevelStyle[] = design.levels.map((entry) => ({ ...entry }));
  while (levels.length <= level) levels.push({});
  const entry = levels[level] as MenuLevelStyle;
  if (part === 'current') {
    if (rules?.base && Object.keys(rules.base).length) entry.current = rules.base;
    else delete entry.current;
  } else if (rules && Object.keys(rules).length) entry[part] = rules;
  else delete entry[part];
  while (levels.length && Object.keys(levels[levels.length - 1] as object).length === 0)
    levels.pop();
  return { ...design, levels };
}

/** The design with the mobile settings patched; unset keys are removed. */
export function withMobile(
  design: MenuDesign,
  patch: { [K in keyof MenuMobile]?: MenuMobile[K] | undefined },
): MenuDesign {
  const mobile: Record<string, unknown> = { ...design.mobile, ...patch };
  for (const [key, value] of Object.entries(mobile)) if (value === undefined) delete mobile[key];
  return { ...design, mobile: mobile as unknown as MenuMobile };
}

/** Whether the mobile toggle and panel exist. */
export const collapses = (design: MenuDesign): boolean =>
  design.mobile.behaviour === 'burger' || design.mobile.behaviour === 'offcanvas';

/** The design with its outer box's styles replaced. */
export function withRootRules(design: MenuDesign, rules: StyleRules | undefined): MenuDesign {
  const next = { ...design };
  if (rules && Object.keys(rules).length) next.root = rules;
  else delete next.root;
  return next;
}

export interface MenuDesignRow {
  key: string;
  label: string;
  /** The space menu of that machine name, when there is one. */
  menuId: string | null;
  status: 'generated' | 'unpublished' | 'changed' | 'published';
  stored: boolean;
}

/** One row per space menu (its own design) plus stored designs under other keys. */
export function menuDesignRows(
  menus: ReadonlyArray<{ id: string; name: string; machineName: string }>,
  summaries: ReadonlyArray<{
    kind: string;
    key: string;
    label: string;
    status: MenuDesignRow['status'];
    id: string | null;
  }>,
): MenuDesignRow[] {
  const byKey = new Map(
    summaries.filter((entry) => entry.kind === 'menu').map((entry) => [entry.key, entry]),
  );
  const rows: MenuDesignRow[] = menus.map((menu) => {
    const summary = byKey.get(menu.machineName);
    byKey.delete(menu.machineName);
    return {
      key: menu.machineName,
      label: menu.name,
      menuId: menu.id,
      status: summary?.status ?? 'generated',
      stored: Boolean(summary?.id),
    };
  });
  for (const entry of byKey.values())
    if (entry.id)
      rows.push({
        key: entry.key,
        label: entry.label,
        menuId: null,
        status: entry.status,
        stored: true,
      });
  return rows;
}
