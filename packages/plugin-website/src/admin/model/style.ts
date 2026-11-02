import type { StylePropName, StyleProps, StyleRuleKey, StyleRules } from '@manablox/site';

/** A section of the style inspector and the props it sets, for its "n set" count. */
export interface StyleGroup {
  id: string;
  label: string;
  props: readonly StylePropName[];
}

/** The inspector's sections, in order. */
export const STYLE_GROUPS: readonly StyleGroup[] = [
  {
    id: 'spacing',
    label: 'Spacing',
    props: [
      'padding',
      'paddingX',
      'paddingY',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'margin',
      'marginX',
      'marginY',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'gap',
    ],
  },
  {
    id: 'size',
    label: 'Size',
    props: ['maxWidth', 'aspectRatio', 'width', 'minWidth', 'height', 'minHeight', 'maxHeight'],
  },
  {
    id: 'layout',
    label: 'Layout',
    props: ['display', 'direction', 'align', 'justify', 'wrap', 'columns', 'alignSelf', 'grow'],
  },
  {
    id: 'type',
    label: 'Text',
    props: [
      'type',
      'font',
      'fontWeight',
      'textAlign',
      'textTransform',
      'textDecoration',
      'fontStyle',
    ],
  },
  { id: 'color', label: 'Colors', props: ['color', 'background'] },
  {
    id: 'border',
    label: 'Border and shadow',
    props: ['borderWidth', 'borderStyle', 'borderColor', 'radius', 'shadow'],
  },
  {
    id: 'effects',
    label: 'Effects',
    props: ['opacity', 'overflow', 'objectFit', 'objectPosition'],
  },
];

/** Where a rule applies: a breakpoint, or a state on desktop. */
export const STYLE_TARGETS: ReadonlyArray<{ value: StyleRuleKey; label: string }> = [
  { value: 'base', label: 'Normal' },
  { value: 'hover', label: 'Hover' },
  { value: 'focus', label: 'Focus' },
  { value: 'active', label: 'Pressed' },
];

/** Sets or clears several props of one rule; empty rules and an empty result are dropped. */
export function setStyleProps(
  rules: StyleRules | undefined,
  target: StyleRuleKey,
  values: Partial<Record<StylePropName, unknown>>,
): StyleRules | undefined {
  const current: Record<string, unknown> = { ...(rules?.[target] ?? {}) };
  for (const [prop, value] of Object.entries(values)) {
    if (value === undefined || value === '' || value === null) delete current[prop];
    else current[prop] = value;
  }
  const next: StyleRules = { ...(rules ?? {}) };
  if (Object.keys(current).length > 0) next[target] = current as StyleProps;
  else delete next[target];
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Drops every prop of one rule. */
export function clearStyleTarget(
  rules: StyleRules | undefined,
  target: StyleRuleKey,
): StyleRules | undefined {
  const next: StyleRules = { ...(rules ?? {}) };
  delete next[target];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The value a target inherits for a prop: tablet falls back to desktop, mobile to tablet
 * then desktop, and states to desktop.
 */
export function inheritedValue(
  rules: StyleRules | undefined,
  target: StyleRuleKey,
  prop: StylePropName,
): unknown {
  const chain: StyleRuleKey[] =
    target === 'mobile' ? ['tablet', 'base'] : target === 'base' ? [] : ['base'];
  for (const key of chain) {
    const value = rules?.[key]?.[prop];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** How many props a rule sets, per target, for the target switch's counts. */
export function countByTarget(
  rules: StyleRules | undefined,
): Partial<Record<StyleRuleKey, number>> {
  const out: Partial<Record<StyleRuleKey, number>> = {};
  for (const [key, props] of Object.entries(rules ?? {})) {
    const count = Object.keys(props ?? {}).length;
    if (count) out[key as StyleRuleKey] = count;
  }
  return out;
}
