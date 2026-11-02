import type {
  Breakpoint,
  ButtonVariant,
  ElementKind,
  InstanceStyle,
  SiteDesignKind,
} from './types.js';
import { isRecord, shortHash, stableStringify } from './util.js';

/**
 * Class names shared by the CSS compiler and the renderer. Markup contract:
 * - every element: `elementClass(el)`, plus `classFor(kind, key, node.id)` when it has style;
 * - `section`: an inner `div.mb-container` (plus `mb-container-<name>` for `props.container`);
 * - `button`, `formSubmit`: `mb-button mb-button-<variant>`; inputs `mb-input`, labels `mb-label`;
 * - `richtext`: `mb-prose`; nodes hidden at a breakpoint: `hiddenClass(breakpoint)`;
 * - menus: see `MENU_CLASSES`.
 */

/** Class of a styled node, e.g. `mb-block-1a2b3c4d-n4k2x9q`. */
export function classFor(kind: SiteDesignKind, key: string, nodeId: string): string {
  return `mb-${kind}-${shortHash(key)}-${nodeId}`;
}

/** Base class of every element of a kind, e.g. `mb-e-form-field`. */
export function elementClass(el: ElementKind): string {
  return `mb-e-${el.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

export function hiddenClass(breakpoint: Breakpoint): string {
  return `mb-hide-${breakpoint}`;
}

export function containerClass(name?: string): string {
  return name ? `mb-container-${name}` : CONTAINER_CLASS;
}

export function buttonClass(variant: ButtonVariant): string {
  return `mb-button-${variant}`;
}

export const CONTAINER_CLASS = 'mb-container';
export const BUTTON_CLASS = 'mb-button';
export const INPUT_CLASS = 'mb-input';
export const LABEL_CLASS = 'mb-label';
export const PROSE_CLASS = 'mb-prose';
/** Visually hidden, still read by screen readers. */
export const SR_ONLY_CLASS = 'mb-sr-only';
/** The honeypot input of a form. */
export const HONEYPOT_CLASS = 'mb-hp';
/** A field's message after a form was posted without JavaScript. */
export const FORM_ERROR_CLASS = 'mb-form-error';
/** `data-mb-scheme="light|dark"` on `<html>` forces a color scheme. */
export const SCHEME_ATTRIBUTE = 'data-mb-scheme';

/**
 * Menu markup: `nav.mb-menu.<menuClass(key)>` holding `button.mb-menu-toggle` and
 * `div.mb-menu-panel`, which holds `ul.mb-menu-list.mb-menu-l0` of `li.mb-menu-item` with
 * `a.mb-menu-link` and a nested `ul.mb-menu-list.mb-menu-l1`. The shown page's link has
 * `aria-current="page"`, its ancestors' links `aria-current="true"`. The menu island toggles
 * `data-open` on the `nav` and on items.
 */
export const MENU_CLASSES = {
  root: 'mb-menu',
  toggle: 'mb-menu-toggle',
  panel: 'mb-menu-panel',
  list: 'mb-menu-list',
  item: 'mb-menu-item',
  link: 'mb-menu-link',
} as const;

export function menuClass(key: string): string {
  return `mb-menu-${shortHash(key)}`;
}

export function menuLevelClass(level: number): string {
  return `mb-menu-l${level}`;
}

/** Keeps only set entries, so equal overrides share a class. */
export function normalizeInstanceStyle(
  style: InstanceStyle | null | undefined,
): InstanceStyle | null {
  if (!isRecord(style)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = [...value].sort();
    } else out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as InstanceStyle) : null;
}

/** Class of a block instance's overrides; `null` when there are none. */
export function instanceClass(style: InstanceStyle | null | undefined): string | null {
  const normalized = normalizeInstanceStyle(style);
  return normalized ? `mb-i-${shortHash(stableStringify(normalized))}` : null;
}
